import { UserModel } from '../models/userModel.js';
import { MessageModel } from '../models/messageModel.js';
import { presence } from './presence.js';

export function buildUserList(forUsername: string) {
  const users = UserModel.listApproved();
  const unreadMap = MessageModel.unreadCountsFor(forUsername);
  const now = Date.now();

  return users.map((u) => ({
    name: u.username,
    role: u.role,
    presenceStatus: presence.statusOf(u.username),
    isMuted: Boolean(u.muted_until && u.muted_until > now),
    unreadCount: unreadMap[u.username] || 0,
  }));
}