import { db } from '../db/index.js';

const insertSaved = db.prepare(`INSERT OR IGNORE INTO saved_users (owner, saved, created_at) VALUES (?, ?, ?)`);
const removeSaved = db.prepare(`DELETE FROM saved_users WHERE owner = ? AND saved = ?`);
const listSaved = db.prepare(`SELECT saved FROM saved_users WHERE owner = ?`);

export const SavedUserModel = {
  add(owner: string, saved: string): void {
    insertSaved.run(owner, saved, Date.now());
  },

  remove(owner: string, saved: string): void {
    removeSaved.run(owner, saved);
  },

  savedBy(owner: string): Set<string> {
    const rows = listSaved.all(owner) as unknown as { saved: string }[];
    return new Set(rows.map((row) => row.saved));
  },
};