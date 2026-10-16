import { UserModel } from '../../models/userModel.js';
import { BlockModel } from '../../models/blockModel.js';
import { MessageModel, type Poll } from '../../models/messageModel.js';
import { createPollSchema, votePollSchema, idSchema, safeParse } from '../../utils/validation.js';
import { createSocketRateLimiter } from '../../utils/socketRateLimiter.js';
import { broadcastMessage, broadcastUpdate } from './chatHandlers.js';
import type { Ack, AppServer, AppSocket } from '../types.js';

const createRateLimiter = createSocketRateLimiter({ windowMs: 60_000, max: 5 });
const voteRateLimiter = createSocketRateLimiter({ windowMs: 10_000, max: 20 });

export function registerPollHandlers(io: AppServer, socket: AppSocket) {
  const { username: name } = socket.user;

  const reply = (acknowledge?: Ack) => (result: Record<string, unknown>) => {
    if (typeof acknowledge === 'function') acknowledge(result);
  };

  socket.on('create poll', (data: unknown, acknowledge?: Ack) => {
    const respond = reply(acknowledge);
    if (!createRateLimiter(name)) return respond({ ok: false, error: 'You are creating polls too quickly.' });

    const user = UserModel.findByUsername(name);
    if (!user || user.status !== 'approved') {
      socket.emit('force logout');
      return respond({ ok: false, error: 'Your account is no longer approved.' });
    }
    if (user.muted_until && user.muted_until > Date.now()) {
      return respond({ ok: false, error: 'You are currently timed out.' });
    }

    const parsed = safeParse(createPollSchema, data);
    if (!parsed.ok) return respond({ ok: false, error: parsed.error });

    const to = parsed.data.to || 'global';
    if (to !== 'global') {
      const target = UserModel.findByUsername(to);
      if (!target || target.status !== 'approved') return respond({ ok: false, error: 'That user does not exist.' });
      if (BlockModel.either(name, to)) return respond({ ok: false, error: 'You cannot message this user.' });
    }

    const poll: Poll = {
      question: parsed.data.question,
      options: parsed.data.options.map((text) => ({ text, votes: [] })),
      multi: parsed.data.multi,
      closed: false,
    };
    const entry = MessageModel.create({ user: name, msg: poll.question, role: user.role, to, poll });
    broadcastMessage(io, socket, entry);
    respond({ ok: true });
  });

  socket.on('vote poll', (data: unknown, acknowledge?: Ack) => {
    const respond = reply(acknowledge);
    if (!voteRateLimiter(name)) return respond({ ok: false, error: 'Slow down a bit.' });

    const parsed = safeParse(votePollSchema, data);
    if (!parsed.ok) return respond({ ok: false, error: parsed.error });

    const message = MessageModel.findById(parsed.data.id);
    const canAccess = message && (message.to === 'global' || message.user === name || message.to === name);
    if (!message || !message.poll || !canAccess) return respond({ ok: false, error: 'That poll is unavailable.' });
    if (message.to !== 'global' && BlockModel.either(message.user, message.to)) {
      return respond({ ok: false, error: 'That poll is unavailable.' });
    }
    if (message.poll.closed) return respond({ ok: false, error: 'This poll is closed.' });

    const updated = MessageModel.votePoll(message.id, name, parsed.data.option);
    if (!updated) return respond({ ok: false, error: 'That option does not exist.' });
    broadcastUpdate(io, socket, updated);
    respond({ ok: true });
  });

  socket.on('close poll', (id: unknown, acknowledge?: Ack) => {
    const respond = reply(acknowledge);
    const parsed = safeParse(idSchema, id);
    if (!parsed.ok) return respond({ ok: false, error: 'That poll is unavailable.' });

    const user = UserModel.findByUsername(name);
    const message = MessageModel.findById(parsed.data);
    if (!user || !message || !message.poll) return respond({ ok: false, error: 'That poll is unavailable.' });
    if (message.user !== name && user.role !== 'admin') {
      return respond({ ok: false, error: 'Only the poll creator or an admin can close it.' });
    }
    if (message.poll.closed) return respond({ ok: true });

    const updated = MessageModel.closePoll(message.id);
    if (updated) broadcastUpdate(io, socket, updated);
    respond({ ok: true });
  });
}