import { BlockModel } from '../models/blockModel.js';
import type { AppServer, AppSocket } from './types.js';

export function findSocketByUsername(io: AppServer, username: string): AppSocket | null {
  for (const s of io.sockets.sockets.values()) {
    if (s.user && s.user.username === username) return s;
  }
  return null;
}

export function withoutBlocked<T extends { user: string; to: string }>(messages: T[], viewer: string): T[] {
  const blocked = BlockModel.blockedBy(viewer);
  if (!blocked.size) return messages;
  return messages.filter((message) => message.to !== 'global' || !blocked.has(message.user));
}