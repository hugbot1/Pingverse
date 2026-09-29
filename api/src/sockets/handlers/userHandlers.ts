import { buildUserList } from '../userList.js';
import { presence } from '../presence.js';
import { presenceStatusSchema, safeParse } from '../../utils/validation.js';
import type { AppServer, AppSocket } from '../types.js';

export function registerUserHandlers(_io: AppServer, socket: AppSocket) {
  const { username: name } = socket.user;

  socket.on('get users', () => {
    socket.emit('user list', buildUserList(name));
  });

  socket.on('set presence', (requestedStatus: unknown) => {
    const parsed = safeParse(presenceStatusSchema, requestedStatus);
    if (!parsed.ok) return;
    const changed = presence.setStatus(name, parsed.data);
    for (const connected of _io.sockets.sockets.values()) {
      if (connected.user?.username === name) connected.emit('presence status', presence.statusOf(name));
    }
    if (changed) _io.emit('status change');
  });

  socket.on('presence activity', () => {
    if (presence.activity(name)) {
      for (const connected of _io.sockets.sockets.values()) {
        if (connected.user?.username === name) connected.emit('presence status', 'online');
      }
      _io.emit('status change');
    }
  });
}