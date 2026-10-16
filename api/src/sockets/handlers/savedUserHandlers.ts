import { UserModel } from '../../models/userModel.js';
import { SavedUserModel } from '../../models/savedUserModel.js';
import { usernameOnlySchema, safeParse } from '../../utils/validation.js';
import { createSocketRateLimiter } from '../../utils/socketRateLimiter.js';
import { buildUserList } from '../userList.js';
import type { Ack, AppServer, AppSocket } from '../types.js';

const savedUserRateLimiter = createSocketRateLimiter({ windowMs: 10_000, max: 20 });

export function registerSavedUserHandlers(io: AppServer, socket: AppSocket) {
  const { username: name } = socket.user;

  function setSaved(data: unknown, saved: boolean, acknowledge?: Ack) {
    const respond = (result: Record<string, unknown>) => {
      if (typeof acknowledge === 'function') acknowledge(result);
    };
    if (!savedUserRateLimiter(name)) return respond({ ok: false, error: 'Slow down a bit.' });

    const parsed = safeParse(usernameOnlySchema, data);
    if (!parsed.ok) return respond({ ok: false, error: parsed.error });

    const target = UserModel.findByUsername(parsed.data);
    if (!target || target.status !== 'approved' || target.username === name) {
      return respond({ ok: false, error: 'That user is unavailable.' });
    }

    if (saved) SavedUserModel.add(name, target.username);
    else SavedUserModel.remove(name, target.username);

    for (const connected of io.sockets.sockets.values()) {
      if (connected.user.username === name) connected.emit('user list', buildUserList(name));
    }
    respond({ ok: true, saved });
  }

  socket.on('save user', (username: unknown, acknowledge?: Ack) => setSaved(username, true, acknowledge));
  socket.on('unsave user', (username: unknown, acknowledge?: Ack) => setSaved(username, false, acknowledge));
}