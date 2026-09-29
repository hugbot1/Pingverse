export type PresenceStatus = 'online' | 'idle' | 'dnd';
type PresenceEntry = { status: PresenceStatus; lastActiveAt: number; connections: number };

const users = new Map<string, PresenceEntry>();
const IDLE_AFTER_MS = 5 * 60 * 1000;

export const presence = {
  add(username: string): void {
    const current = users.get(username);
    if (current) {
      current.connections += 1;
      return;
    }
    users.set(username, { status: 'online', lastActiveAt: Date.now(), connections: 1 });
  },

  remove(username: string): boolean {
    const current = users.get(username);
    if (!current) return false;
    current.connections -= 1;
    if (current.connections > 0) return false;
    users.delete(username);
    return true;
  },

  statusOf(username: string): PresenceStatus | 'offline' {
    const current = users.get(username);
    if (!current) return 'offline';
    if (current.status === 'online' && Date.now() - current.lastActiveAt >= IDLE_AFTER_MS) {
      current.status = 'idle';
    }
    return current.status;
  },

  setStatus(username: string, status: PresenceStatus): boolean {
    const current = users.get(username);
    if (!current || !['online', 'idle', 'dnd'].includes(status)) return false;
    current.lastActiveAt = Date.now();
    if (current.status === status) return false;
    current.status = status;
    return true;
  },

  activity(username: string): boolean {
    const current = users.get(username);
    if (!current) return false;
    current.lastActiveAt = Date.now();
    if (current.status !== 'idle') return false;
    current.status = 'online';
    return true;
  },

  expireIdle(): boolean {
    let changed = false;
    for (const [username, current] of users) {
      if (current.status === 'online' && Date.now() - current.lastActiveAt >= IDLE_AFTER_MS) {
        current.status = 'idle';
        changed = true;
      }
    }
    return changed;
  },
};