import { UserModel } from '../../models/userModel.js';
import { usernameOnlySchema, safeParse } from '../../utils/validation.js';
import type { Ack, AppServer, AppSocket } from '../types.js';

const MAX_ROOM_SIZE = 8;
const adminMutedUsers = new Map<string, Set<string>>();
const roomDetails = new Map<string, { conversation: string; members: Set<string> }>();

type VoiceSignal = { type?: string; sdp?: unknown; candidate?: { candidate?: unknown } };

function mutedUsersFor(key: string) {
  let users = adminMutedUsers.get(key);
  if (!users) {
    users = new Set();
    adminMutedUsers.set(key, users);
  }
  return users;
}

function roomKeyFor(username: string, conversation: string) {
  if (conversation === 'global') return 'voice:global';
  return `voice:dm:${[username, conversation].sort((a, b) => a.localeCompare(b)).map(encodeURIComponent).join(':')}`;
}

function leaveVoiceRoom(io: AppServer, socket: AppSocket) {
  const current = socket.data.voiceRoom;
  if (!current) return;
  socket.data.voiceRoom = null;
  socket.leave(current.key);
  io.to(current.key).emit('voice participant left', { id: socket.id, username: socket.user.username });
  broadcastVoicePresence(io, current.key);
}

function broadcastVoicePresence(io: AppServer, key: string) {
  const details = roomDetails.get(key);
  if (!details) return;
  const participants = [...(io.sockets.adapter.rooms.get(key) || [])].map((id) => {
    const username = io.sockets.sockets.get(id)?.user?.username || 'User';
    return { username, adminMuted: adminMutedUsers.get(key)?.has(username) || false };
  });
  for (const recipient of io.sockets.sockets.values()) {
    if (details.conversation === 'global' || details.members.has(recipient.user?.username)) {
      const to = details.conversation === 'global'
        ? 'global'
        : [...details.members].find((member) => member !== recipient.user?.username);
      if (to) recipient.emit('voice presence', { to, participants });
    }
  }
  if (!participants.length) {
    adminMutedUsers.delete(key);
    roomDetails.delete(key);
  }
}

function validConversation(name: string, conversation: string) {
  if (conversation === 'global') return true;
  const parsed = safeParse(usernameOnlySchema, conversation);
  const target = parsed.ok && UserModel.findByUsername(parsed.data);
  return Boolean(parsed.ok && target && target.status === 'approved' && conversation !== name);
}

function sendVoicePresence(io: AppServer, socket: AppSocket, conversation: string) {
  const key = roomKeyFor(socket.user.username, conversation);
  const participants = [...(io.sockets.adapter.rooms.get(key) || [])].map((id) => {
    const username = io.sockets.sockets.get(id)?.user?.username || 'User';
    return { username, adminMuted: adminMutedUsers.get(key)?.has(username) || false };
  });
  socket.emit('voice presence', { to: conversation, participants });
}

export function registerVoiceHandlers(io: AppServer, socket: AppSocket) {
  socket.on('voice join', (data: { to?: string } | null = {}, acknowledge?: Ack) => {
    const respond = (result: Record<string, unknown>) => { if (typeof acknowledge === 'function') acknowledge(result); };
    const conversation = data?.to || 'global';
    if (!validConversation(socket.user.username, conversation)) return respond({ ok: false, error: 'That private voice room is unavailable.' });

    const key = roomKeyFor(socket.user.username, conversation);
    const participants = io.sockets.adapter.rooms.get(key);
    if (!socket.data.voiceRoom && (participants?.size ?? 0) >= MAX_ROOM_SIZE) {
      return respond({ ok: false, error: 'This voice room is full.' });
    }
    if (socket.data.voiceRoom?.key !== key) leaveVoiceRoom(io, socket);
    if (!roomDetails.has(key)) {
      roomDetails.set(key, { conversation, members: conversation === 'global' ? new Set() : new Set([socket.user.username, conversation]) });
    }

    const existing = [...(io.sockets.adapter.rooms.get(key) || [])]
      .filter((id) => id !== socket.id)
      .map((id) => {
        const username = io.sockets.sockets.get(id)?.user?.username || 'User';
        return { id, username, adminMuted: mutedUsersFor(key).has(username) };
      });
    socket.data.voiceRoom = { key, conversation };
    socket.join(key);
    socket.to(key).emit('voice participant joined', { id: socket.id, username: socket.user.username });
    broadcastVoicePresence(io, key);
    respond({ ok: true, to: conversation, participants: existing, forcedMuted: mutedUsersFor(key).has(socket.user.username) });
  });

  socket.on('voice leave', () => leaveVoiceRoom(io, socket));

  socket.on('get voice participants', (data: { to?: string } | null = {}) => {
    const conversation = data?.to || 'global';
    if (!validConversation(socket.user.username, conversation)) return socket.emit('voice presence', { to: conversation, participants: [] });
    sendVoicePresence(io, socket, conversation);
  });

  socket.on('voice moderation mute', (data: { username?: unknown; muted?: unknown } | null = {}, acknowledge?: Ack) => {
    const respond = (result: Record<string, unknown>) => { if (typeof acknowledge === 'function') acknowledge(result); };
    const actor = UserModel.findByUsername(socket.user.username);
    const room = socket.data.voiceRoom;
    if (!actor || actor.status !== 'approved' || actor.role !== 'admin') return respond({ ok: false, error: 'Only an admin can mute someone for the whole voice room.' });
    const targetName = data?.username;
    const muted = data?.muted;
    if (!room || typeof targetName !== 'string' || typeof muted !== 'boolean') return respond({ ok: false, error: 'That voice participant is unavailable.' });
    const targets = [...(io.sockets.adapter.rooms.get(room.key) || [])]
      .map((id) => io.sockets.sockets.get(id))
      .filter((candidate): candidate is AppSocket => candidate?.user?.username === targetName);
    if (!targets.length) return respond({ ok: false, error: 'That user is no longer in the voice room.' });
    const mutedUsers = mutedUsersFor(room.key);
    if (muted) mutedUsers.add(targetName);
    else mutedUsers.delete(targetName);
    io.to(room.key).emit('voice moderation update', { username: targetName, muted, by: actor.username });
    for (const target of targets) target.emit('voice forced mute', { muted, by: actor.username });
    broadcastVoicePresence(io, room.key);
    respond({ ok: true, muted });
  });

  socket.on('voice signal', (data: { to?: unknown; signal?: unknown } | null = {}) => {
    const room = socket.data.voiceRoom;
    if (!room || !data || typeof data.to !== 'string' || !data.signal || typeof data.signal !== 'object') return;
    const target = io.sockets.sockets.get(data.to);
    if (!target || target.data.voiceRoom?.key !== room.key) return;
    const signal = data.signal as VoiceSignal;
    if (signal.type === 'offer' || signal.type === 'answer') {
      if (typeof signal.sdp !== 'string' || signal.sdp.length > 50_000) return;
    } else if (signal.candidate) {
      if (typeof signal.candidate.candidate !== 'string' || signal.candidate.candidate.length > 4096) return;
    } else return;
    target.emit('voice signal', { from: socket.id, username: socket.user.username, signal });
  });

  socket.on('disconnect', () => leaveVoiceRoom(io, socket));
}