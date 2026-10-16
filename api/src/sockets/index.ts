import type http from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { readSessionToken } from '../utils/cookies.js';
import { verifySession } from '../utils/jwt.js';
import { UserModel } from '../models/userModel.js';
import { MessageModel } from '../models/messageModel.js';
import { AnnouncementModel } from '../models/announcementModel.js';
import { presence } from './presence.js';
import { buildUserList } from './userList.js';
import { withoutBlocked } from './utils.js';
import { registerChatHandlers } from './handlers/chatHandlers.js';
import { registerUserHandlers } from './handlers/userHandlers.js';
import { registerAccountHandlers } from './handlers/accountHandlers.js';
import { registerVoiceHandlers } from './handlers/voiceHandlers.js';
import { registerBlockHandlers } from './handlers/blockHandlers.js';
import { registerSavedUserHandlers } from './handlers/savedUserHandlers.js';
import { registerPollHandlers } from './handlers/pollHandlers.js';
import { errorMessage } from '../utils/errors.js';
import type { AppServer } from './types.js';

export function createSocketServer(httpServer: http.Server): AppServer {
  const io: AppServer = new Server(httpServer, {
    cors: {
      origin: env.clientUrl,
      credentials: true,
    },
  });

  io.engine.on('connection_error', (error) => {
    console.error('[socket.io] transport connection error:', error.code, error.message);
  });

  const idleSweep = setInterval(() => {
    if (presence.expireIdle()) io.emit('status change');
  }, 30_000);
  idleSweep.unref?.();

  io.use((socket, next) => {
    const token = readSessionToken(socket.handshake.headers.cookie);
    const username = verifySession(token);
    if (!username) return next(new Error('Unauthorized'));

    const user = UserModel.findByUsername(username);
    if (!user || user.status !== 'approved') return next(new Error('Unauthorized'));

    socket.user = { username: user.username, role: user.role };
    next();
  });

  io.on('connection', (socket) => {
    const { username: name, role } = socket.user;
    console.info('[socket.io] client connected');

    presence.add(name);
    io.emit('status change');

    socket.emit('announcement', AnnouncementModel.latest());
    socket.emit('presence status', presence.statusOf(name));

    const history = withoutBlocked(MessageModel.historyForUser(name, 150), name);
    const self = UserModel.findByUsername(name);
    socket.emit('welcome', {
      username: name,
      role,
      history,
      bio: self?.bio || '',
      hasAvatar: Boolean(self?.avatar_type),
      avatarVersion: self?.avatar_version || 0,
    });
    socket.emit('user list', buildUserList(name));

    registerChatHandlers(io, socket);
    registerUserHandlers(io, socket);
    registerAccountHandlers(io, socket);
    registerVoiceHandlers(io, socket);
    registerBlockHandlers(io, socket);
    registerSavedUserHandlers(io, socket);
    registerPollHandlers(io, socket);

    socket.on('disconnect', () => {
      if (presence.remove(name)) io.emit('status change');
    });
    socket.on('disconnect', (reason) => {
      console.info('[socket.io] client disconnected:', reason);
    });
    socket.on('error', (error) => {
      console.error('[socket.io] client socket error:', errorMessage(error));
    });
  });

  return io;
}