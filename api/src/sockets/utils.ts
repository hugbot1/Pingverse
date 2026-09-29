import type { AppServer, AppSocket } from './types.js';

export function findSocketByUsername(io: AppServer, username: string): AppSocket | null {
  for (const s of io.sockets.sockets.values()) {
    if (s.user && s.user.username === username) return s;
  }
  return null;
}