import { db } from '../db/index.js';

type AnnouncementRow = { id: number; msg: string; important: number; ts: number };

export type Announcement = { msg: string; important: boolean; ts?: number };

const insert = db.prepare(`INSERT INTO announcements (msg, important, ts) VALUES (?, ?, ?)`);
const latest = db.prepare(`SELECT * FROM announcements ORDER BY ts DESC LIMIT 1`);
const clearAll = db.prepare(`DELETE FROM announcements`);

function serialize(row: AnnouncementRow | undefined): Announcement {
  if (!row) return { msg: '', important: false };
  return { msg: row.msg, important: Boolean(row.important), ts: row.ts };
}

function latestRow(): AnnouncementRow | undefined {
  return latest.get() as unknown as AnnouncementRow | undefined;
}

export const AnnouncementModel = {
  latest(): Announcement {
    return serialize(latestRow());
  },
  set(msg: string, important: boolean): Announcement {
    clearAll.run();
    insert.run(msg, important ? 1 : 0, Date.now());
    return serialize(latestRow());
  },
};