import { UserModel } from '../../models/userModel.js';
import { MessageModel, type Attachment, type Message, type PinInfo, type ReplyTo } from '../../models/messageModel.js';
import { findSocketByUsername } from '../utils.js';
import { createSocketRateLimiter } from '../../utils/socketRateLimiter.js';
import { errorMessage } from '../../utils/errors.js';
import type { Ack, AppServer, AppSocket } from '../types.js';
import {
  chatMessageSchema,
  editMessageSchema,
  idSchema,
  usernameOnlySchema,
  typingSchema,
  forwardMessageSchema,
  reactionSchema,
  safeParse,
} from '../../utils/validation.js';

const chatRateLimiter = createSocketRateLimiter({ windowMs: 10_000, max: 8 });

function broadcastMessage(io: AppServer, socket: AppSocket, entry: Message) {
  if (entry.to === 'global') {
    io.emit('chat message', entry);
    return;
  }
  const sender = socket.user.username;
  for (const connected of io.sockets.sockets.values()) {
    const username = connected.user?.username;
    if (username === sender || username === entry.to) {
      connected.emit('chat message', entry);
      connected.emit('user list update');
    }
  }
}

function broadcastUpdate(io: AppServer, _socket: AppSocket, msg: Message) {
  if (msg.to === 'global') {
    io.emit('msg updated', msg);
    return;
  }
  for (const connected of io.sockets.sockets.values()) {
    const username = connected.user?.username;
    if (username === msg.user || username === msg.to) connected.emit('msg updated', msg);
  }
}

function canAccessMessage(message: Message, username: string) {
  return message.to === 'global' || message.user === username || message.to === username;
}

export function registerChatHandlers(io: AppServer, socket: AppSocket) {
  const { username: name } = socket.user;

  function broadcastTyping(isTyping: boolean, conversation: string) {
    const event = { username: name, to: conversation, isTyping };
    if (conversation === 'global') {
      socket.broadcast.emit('typing', event);
      return;
    }
    for (const recipient of io.sockets.sockets.values()) {
      if (recipient.id !== socket.id && recipient.user?.username === conversation) {
        recipient.emit('typing', event);
      }
    }
  }

  function broadcastPinChange(message: Message, pin: PinInfo | null) {
    const payload = { id: message.id, pinned: Boolean(pin), pinnedBy: pin?.pinned_by || null, pinnedAt: pin?.pinned_at || null };
    if (message.to === 'global') io.emit('pin changed', payload);
    else for (const recipient of io.sockets.sockets.values()) {
      if (recipient.user?.username === message.user || recipient.user?.username === message.to) recipient.emit('pin changed', payload);
    }
  }

  socket.on('get pinned messages', (data: { to?: string } = {}) => {
    const to = data.to || 'global';
    if (to !== 'global') {
      const parsed = safeParse(usernameOnlySchema, to);
      const target = parsed.ok && UserModel.findByUsername(parsed.data);
      if (!parsed.ok || !target || target.status !== 'approved' || to === name) return;
    }
    socket.emit('pinned messages', { to, messages: MessageModel.pinsForConversation(to, name) });
  });

  socket.on('get saved messages', () => socket.emit('saved messages', MessageModel.savedForUser(name)));

  socket.on('search messages', (
    data: { to?: string; query?: unknown; author?: unknown; sort?: unknown; requestId?: unknown } = {}
  ) => {
    const user = UserModel.findByUsername(name);
    if (!user || user.status !== 'approved') return socket.emit('force logout');
    const to = data.to || 'global';
    const query = typeof data.query === 'string' ? data.query.trim().slice(0, 120) : '';
    const author = typeof data.author === 'string' ? data.author.trim().slice(0, 20) : '';
    const sort = data.sort === 'old' ? 'old' : 'new';
    if (to !== 'global') {
      const parsed = safeParse(usernameOnlySchema, to);
      const target = parsed.ok && UserModel.findByUsername(parsed.data);
      if (!parsed.ok || !target || target.status !== 'approved' || to === name) return;
    }
    try {
      const results = MessageModel.search({ username: name, to, query, author, sort, limit: 200 });
      socket.emit('message search results', { to, requestId: data.requestId, results, limited: results.length === 200 });
    } catch {
      socket.emit('error notice', 'Could not search messages.');
    }
  });

  socket.on('toggle pin', (data: { id?: unknown } | undefined, acknowledge?: Ack) => {
    const respond = (result: Record<string, unknown>) => { if (typeof acknowledge === 'function') acknowledge(result); };
    const parsed = safeParse(idSchema, data?.id);
    const user = UserModel.findByUsername(name);
    if (!parsed.ok || !user || user.status !== 'approved') return respond({ ok: false, error: 'Could not pin that message.' });
    const message = MessageModel.findById(parsed.data);
    if (!message || !canAccessMessage(message, name)) return respond({ ok: false, error: 'That message is unavailable.' });
    if (message.to === 'global' && user.role !== 'admin') return respond({ ok: false, error: 'Only an admin can pin messages in Global Chat.' });
    try {
      const pin = MessageModel.togglePin(parsed.data, name);
      broadcastPinChange(message, pin);
      respond({ ok: true, pinned: Boolean(pin) });
    } catch { respond({ ok: false, error: 'Could not update the pin.' }); }
  });

  socket.on('toggle saved message', (data: { id?: unknown } | undefined, acknowledge?: Ack) => {
    const respond = (result: Record<string, unknown>) => { if (typeof acknowledge === 'function') acknowledge(result); };
    const parsed = safeParse(idSchema, data?.id);
    const user = UserModel.findByUsername(name);
    if (!parsed.ok || !user || user.status !== 'approved') return respond({ ok: false, error: 'Could not save that message.' });
    const message = MessageModel.findById(parsed.data);
    if (!message || !canAccessMessage(message, name)) return respond({ ok: false, error: 'That message is unavailable.' });
    try {
      const saved = MessageModel.toggleSaved(parsed.data, name);
      for (const recipient of io.sockets.sockets.values()) if (recipient.user?.username === name) recipient.emit('saved status', { id: message.id, saved });
      respond({ ok: true, saved });
    } catch { respond({ ok: false, error: 'Could not update saved messages.' }); }
  });

  function clearTyping() {
    clearTimeout(socket.data.typingTimeout);
    const conversation = socket.data.typingConversation;
    if (!conversation) return;
    socket.data.typingConversation = null;
    broadcastTyping(false, conversation);
  }

  socket.on('typing', (data: unknown) => {
    const parsed = safeParse(typingSchema, data);
    if (!parsed.ok) return;
    const { to, isTyping } = parsed.data;
    if (to !== 'global') {
      const target = UserModel.findByUsername(to);
      if (!target || target.status !== 'approved') return clearTyping();
    }

    if (!isTyping) {
      if (socket.data.typingConversation === to) clearTyping();
      return;
    }
    if (socket.data.typingConversation && socket.data.typingConversation !== to) clearTyping();
    if (socket.data.typingConversation !== to) {
      socket.data.typingConversation = to;
      broadcastTyping(true, to);
    }

    clearTimeout(socket.data.typingTimeout);
    socket.data.typingTimeout = setTimeout(clearTyping, 4000);
    socket.data.typingTimeout.unref?.();
  });

  socket.on('chat message', (data: unknown) => {
    if (!chatRateLimiter(name)) {
      const error = 'You are sending messages too quickly. Slow down a bit.';
      socket.emit('error notice', error);
      return;
    }

    const user = UserModel.findByUsername(name);
    if (!user || user.status !== 'approved') {
      socket.emit('force logout');
      return;
    }
    if (user.muted_until && user.muted_until > Date.now()) {
      const error = `You are muted until ${new Date(user.muted_until).toLocaleTimeString()}`;
      socket.emit('error notice', error);
      return;
    }

    const payload = typeof data === 'string' ? { msg: data } : data;
    const parsed = safeParse(chatMessageSchema, payload);
    if (!parsed.ok) {
      socket.emit('error notice', parsed.error);
      return;
    }

    const to = parsed.data.to || 'global';
    const attachments: Attachment[] = [];
    for (const requested of parsed.data.attachments) {
      const file = MessageModel.findUploadedMedia(requested.id, name);
      if (!file) return socket.emit('error notice', `Attachment "${requested.name}" is unavailable.`);
      attachments.push({ id: file.id, name: file.name, type: file.type, size: file.size });
    }
    if (to !== 'global') {
      const target = UserModel.findByUsername(to);
      if (!target || target.status !== 'approved') {
        const error = 'That user does not exist.';
        socket.emit('error notice', error);
        return;
      }
    }

    let replyTo: ReplyTo | null = null;
    if (parsed.data.replyTo) {
      const parent = MessageModel.findById(parsed.data.replyTo.id);
      if (!parent) {
        const error = 'That message can no longer be replied to.';
        socket.emit('error notice', error);
        return;
      }
      const sameGlobalChat = to === 'global' && parent.to === 'global';
      const samePrivateChat = to !== 'global' && (
        (parent.user === name && parent.to === to) ||
        (parent.user === to && parent.to === name)
      );
      if (!sameGlobalChat && !samePrivateChat) {
        const error = 'Replies must stay in the same conversation.';
        socket.emit('error notice', error);
        return;
      }
      replyTo = { id: parent.id, user: parent.user, text: parent.msg.slice(0, 45) };
    }

    try {
      const entry = MessageModel.create({
        user: name,
        msg: parsed.data.msg,
        attachments,
        role: user.role,
        to,
        replyTo,
      });

      broadcastMessage(io, socket, entry);
    } catch (error) {
      console.error('[socket.io] message send failed:', errorMessage(error));
      const message = 'Message could not be saved. Please try again.';
      socket.emit('error notice', message);
    }
  });

  socket.on('forward message', (data: unknown, acknowledge?: Ack) => {
    const respond = (result: Record<string, unknown>) => {
      if (typeof acknowledge === 'function') acknowledge(result);
    };
    if (!chatRateLimiter(name)) {
      return respond({ ok: false, error: 'You are sending messages too quickly. Slow down a bit.' });
    }

    const user = UserModel.findByUsername(name);
    if (!user || user.status !== 'approved') {
      socket.emit('force logout');
      return respond({ ok: false, error: 'Your account is no longer approved.' });
    }
    if (user.muted_until && user.muted_until > Date.now()) {
      return respond({ ok: false, error: 'You are currently timed out.' });
    }

    const parsed = safeParse(forwardMessageSchema, data);
    if (!parsed.ok) return respond({ ok: false, error: parsed.error });
    const { id, to } = parsed.data;
    if (to === name) return respond({ ok: false, error: 'Choose another recipient.' });

    const source = MessageModel.findById(id);
    if (!source) return respond({ ok: false, error: 'That message no longer exists.' });
    if (source.to !== 'global' && source.user !== name && source.to !== name) {
      return respond({ ok: false, error: 'You cannot forward that private message.' });
    }

    if (to !== 'global') {
      const target = UserModel.findByUsername(to);
      if (!target || target.status !== 'approved') {
        return respond({ ok: false, error: 'That user does not exist.' });
      }
    }

    const forwarded = MessageModel.create({
      user: name,
      msg: source.msg,
      attachments: source.attachments || [],
      role: user.role,
      to,
      forwardedFrom: { user: source.forwardedFrom?.user || source.user },
    });
    broadcastMessage(io, socket, forwarded);
    respond({ ok: true });
  });

  socket.on('toggle yeah', (msgId: unknown) => {
    const parsed = safeParse(idSchema, msgId);
    if (!parsed.ok) return;
    const existing = MessageModel.findById(parsed.data);
    if (!existing || !canAccessMessage(existing, name)) return;
    try {
      const updated = MessageModel.toggleYeah(parsed.data, name);
      if (!updated) return;
      broadcastUpdate(io, socket, updated);
    } catch (err) {
      socket.emit('error notice', 'Failed to update Yeah count.');
    }
  });

  socket.on('toggle reaction', (data) => {
    const parsed = safeParse(reactionSchema, data);
    if (!parsed.ok) return socket.emit('error notice', parsed.error);
    const existing = MessageModel.findById(parsed.data.id);
    if (!existing || !canAccessMessage(existing, name)) return;
    try {
      const updated = MessageModel.toggleReaction(parsed.data.id, name, parsed.data.emoji);
      if (updated) broadcastUpdate(io, socket, updated);
    } catch {
      socket.emit('error notice', 'Failed to update reaction.');
    }
  });

  socket.on('edit message', ({ id, newMsg }: { id?: unknown; newMsg?: unknown } = {}) => {
    const parsed = safeParse(editMessageSchema, { id, newMsg });
    if (!parsed.ok) return socket.emit('error notice', parsed.error);

    const existing = MessageModel.findById(parsed.data.id);
    if (!existing || existing.user !== name) return;

    const updated = MessageModel.editMessage(parsed.data.id, parsed.data.newMsg);
    if (updated) broadcastUpdate(io, socket, updated);
  });

  socket.on('delete message', (id: unknown) => {
    const parsed = safeParse(idSchema, id);
    if (!parsed.ok) return;

    const existing = MessageModel.findById(parsed.data);
    if (!existing || existing.user !== name) return;

    MessageModel.deleteById(parsed.data);
    if (existing.to === 'global') {
      io.emit('msg deleted', existing.id);
    } else {
      socket.emit('msg deleted', existing.id);
      const targetSocket = findSocketByUsername(io, existing.to);
      if (targetSocket) targetSocket.emit('msg deleted', existing.id);
    }
  });

  socket.on('mark read', (senderName: unknown) => {
    const parsed = safeParse(usernameOnlySchema, senderName);
    if (!parsed.ok) return;
    MessageModel.markThreadRead(parsed.data, name);
    socket.emit('status change');
  });

  socket.on('disconnect', clearTyping);
}