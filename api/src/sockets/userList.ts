import { UserModel } from '../models/userModel.js';
import { MessageModel } from '../models/messageModel.js';
import { BlockModel } from '../models/blockModel.js';
import { SavedUserModel } from '../models/savedUserModel.js';
import { presence } from './presence.js';

export function buildUserList(forUsername: string) {
  const users = UserModel.listApproved();
  const unreadMap = MessageModel.unreadCountsFor(forUsername);
  const blocked = BlockModel.blockedBy(forUsername);
  const saved = SavedUserModel.savedBy(forUsername);
  const now = Date.now();

  return users.map((u) => ({
    name: u.username,
    role: u.role,
    presenceStatus: presence.statusOf(u.username),
    isMuted: Boolean(u.muted_until && u.muted_until > now),
    unreadCount: blocked.has(u.username) ? 0 : unreadMap[u.username] || 0,
    isBlocked: blocked.has(u.username),
    isSaved: saved.has(u.username),
    hasAvatar: Boolean(u.avatar_type),
    avatarVersion: u.avatar_version,
  }));
}