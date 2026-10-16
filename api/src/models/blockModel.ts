import { db } from '../db/index.js';

const insertBlock = db.prepare(`INSERT OR IGNORE INTO user_blocks (blocker, blocked, created_at) VALUES (?, ?, ?)`);
const removeBlock = db.prepare(`DELETE FROM user_blocks WHERE blocker = ? AND blocked = ?`);
const listBlocked = db.prepare(`SELECT blocked FROM user_blocks WHERE blocker = ?`);
const listBlockers = db.prepare(`SELECT blocker FROM user_blocks WHERE blocked = ?`);
const findEither = db.prepare(
  `SELECT 1 FROM user_blocks WHERE (blocker = ? AND blocked = ?) OR (blocker = ? AND blocked = ?) LIMIT 1`
);

export const BlockModel = {
  block(blocker: string, blocked: string): void {
    insertBlock.run(blocker, blocked, Date.now());
  },

  unblock(blocker: string, blocked: string): void {
    removeBlock.run(blocker, blocked);
  },

  blockedBy(username: string): Set<string> {
    const rows = listBlocked.all(username) as unknown as { blocked: string }[];
    return new Set(rows.map((row) => row.blocked));
  },

  blockersOf(username: string): Set<string> {
    const rows = listBlockers.all(username) as unknown as { blocker: string }[];
    return new Set(rows.map((row) => row.blocker));
  },

  related(username: string): Set<string> {
    return new Set([...BlockModel.blockedBy(username), ...BlockModel.blockersOf(username)]);
  },

  either(a: string, b: string): boolean {
    return Boolean(findEither.get(a, b, b, a));
  },
};