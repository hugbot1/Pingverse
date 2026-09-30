import bcrypt from 'bcryptjs';
import { UserModel } from '../../models/userModel.js';
import { MessageModel } from '../../models/messageModel.js';
import { presence } from '../presence.js';
import { updateAccountSchema, safeParse } from '../../utils/validation.js';
import type { AppServer, AppSocket } from '../types.js';

const BCRYPT_COST = 12;

export function registerAccountHandlers(io: AppServer, socket: AppSocket) {
  const { username: name, role } = socket.user;

  socket.on('update account', async (data: unknown) => {
    const parsed = safeParse(updateAccountSchema, data || {});
    if (!parsed.ok) return socket.emit('settings error', parsed.error);
    const { username: newUsername, password: newPassword } = parsed.data;

    if (!newUsername && !newPassword) {
      return socket.emit('settings error', 'Nothing to update');
    }

    if (newUsername && newUsername !== name && UserModel.exists(newUsername)) {
      return socket.emit('settings error', 'Username taken');
    }

    const newHash = newPassword ? await bcrypt.hash(newPassword, BCRYPT_COST) : null;
    UserModel.updateCredentials(name, { newUsername: newUsername || null, newHash });

    if (newUsername && newUsername !== name) {
      MessageModel.renameUsername(name, newUsername);
    }

    socket.emit('settings success', 'Updated. Please sign in again.');
  });

  socket.on('delete account', () => {
    if (role === 'admin') {
      return socket.emit('settings error', 'Admin accounts are protected.');
    }

    MessageModel.deleteByUsername(name);
    UserModel.deleteByUsername(name);
    presence.remove(name);

    socket.emit('force logout');
    io.emit('user purged', name);
    io.emit('status change');
  });
}