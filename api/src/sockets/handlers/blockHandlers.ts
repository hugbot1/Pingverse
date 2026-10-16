import { UserModel } from '../../models/userModel.js';
import { BlockModel } from '../../models/blockModel.js';
import { MessageModel } from '../../models/messageModel.js';
import { usernameOnlySchema, safeParse } from '../../utils/validation.js';
import { createSocketRateLimiter } from '../../utils/socketRateLimiter.js';
import { buildUserList } from '../userList.js';
import { withoutBlocked } from '../utils.js';
import type { Ack, AppServer, AppSocket } from '../types.js';

const blockRateLimiter = createSocketRateLimiter({ windowMs: 10_000, max: 10 });

export function registerBlockHandlers(io: AppServer, socket: AppSocket) {
  const { username: name } = socket.user;

  function setBlocked(data: unknown, blocked: boolean, acknowledge?: Ack) {
    const respond = (result: Record<string, unknown>) => {
      if (typeof acknowledge === 'function') acknowledge(result);
    };
    if (!blockRateLimiter(name)) return respond({ ok: false, error: 'Slow down a bit.' });

    const parsed = safeParse(usernameOnlySchema, data);
    if (!parsed.ok) return respond({ ok: false, error: parsed.error });

    const target = UserModel.findByUsername(parsed.data);
    if (!target || target.username === name) return respond({ ok: false, error: 'That user is unavailable.' });
    if (blocked && target.role === 'admin') return respond({ ok: false, error: 'Admins cannot be blocked.' });

    if (blocked) BlockModel.block(name, target.username);
    else BlockModel.unblock(name, target.username);

    const history = withoutBlocked(MessageModel.historyForUser(name, 150), name);
    for (const connected of io.sockets.sockets.values()) {
      if (connected.user.username !== name) continue;
      connected.emit('user list', buildUserList(name));
      connected.emit('history reload', history);
    }
    respond({ ok: true, blocked });
  }

  socket.on('block user', (username: unknown, acknowledge?: Ack) => setBlocked(username, true, acknowledge));
  socket.on('unblock user', (username: unknown, acknowledge?: Ack) => setBlocked(username, false, acknowledge));
}