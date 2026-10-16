import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { env } from '../config/env.js';

fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });

export const db = new DatabaseSync(env.databasePath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    hash          TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    status        TEXT NOT NULL DEFAULT 'approved',
    muted_until   INTEGER,
    created_at    INTEGER NOT NULL,
    bio           TEXT NOT NULL DEFAULT '',
    avatar_version INTEGER NOT NULL DEFAULT 0,
    avatar_type   TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user          TEXT NOT NULL,
    msg           TEXT NOT NULL,
    attachments   TEXT NOT NULL DEFAULT '[]',
    role          TEXT NOT NULL DEFAULT 'user',
    to_user       TEXT NOT NULL DEFAULT 'global',
    reply_to      TEXT,
    forwarded_from TEXT,
    edited        INTEGER NOT NULL DEFAULT 0,
    is_read       INTEGER NOT NULL DEFAULT 0,
    yeahs         TEXT NOT NULL DEFAULT '[]',
    reactions     TEXT NOT NULL DEFAULT '{}',
    poll          TEXT,
    ts            INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS uploaded_media (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_to_user ON messages (to_user);
  CREATE INDEX IF NOT EXISTS idx_messages_user ON messages (user);
  CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages (ts);

  CREATE TABLE IF NOT EXISTS message_pins (
    message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by TEXT NOT NULL,
    pinned_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS saved_messages (
    username TEXT NOT NULL,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    saved_at INTEGER NOT NULL,
    PRIMARY KEY (username, message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_saved_messages_user ON saved_messages (username, saved_at DESC);

  CREATE TABLE IF NOT EXISTS announcements (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    msg           TEXT NOT NULL,
    important     INTEGER NOT NULL DEFAULT 0,
    ts            INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    actor         TEXT NOT NULL,
    action        TEXT NOT NULL,
    target        TEXT,
    detail        TEXT,
    ts            INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_blocks (
    blocker    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE ON UPDATE CASCADE,
    blocked    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE ON UPDATE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (blocker, blocked)
  );
  CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks (blocked);

  CREATE TABLE IF NOT EXISTS saved_users (
    owner      TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE ON UPDATE CASCADE,
    saved      TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE ON UPDATE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (owner, saved)
  );
`);

const userColumns = db.prepare(`PRAGMA table_info(users)`).all() as unknown as { name: string }[];
if (!userColumns.some((column) => column.name === 'status')) {
  db.exec(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'`);
}

const messageColumns = db.prepare(`PRAGMA table_info(messages)`).all() as unknown as { name: string }[];
if (!messageColumns.some((column) => column.name === 'attachments')) {
  db.exec(`ALTER TABLE messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'`);
}
if (!messageColumns.some((column) => column.name === 'forwarded_from')) {
  db.exec(`ALTER TABLE messages ADD COLUMN forwarded_from TEXT`);
}
if (!messageColumns.some((column) => column.name === 'poll')) {
  db.exec(`ALTER TABLE messages ADD COLUMN poll TEXT`);
}
if (!messageColumns.some((column) => column.name === 'reactions')) {
  db.exec(`ALTER TABLE messages ADD COLUMN reactions TEXT NOT NULL DEFAULT '{}'`);
  const legacyRows = db.prepare(`SELECT id, yeahs FROM messages WHERE yeahs != '[]'`).all() as unknown as { id: number; yeahs: string }[];
  const saveReactions = db.prepare(`UPDATE messages SET reactions = ? WHERE id = ?`);
  for (const row of legacyRows) {
    try {
      const users = JSON.parse(row.yeahs || '[]');
      if (Array.isArray(users) && users.length) saveReactions.run(JSON.stringify({ '👍': users }), row.id);
    } catch {
      // ignore
    }
  }
}

if (!userColumns.some((column) => column.name === 'bio')) {
  db.exec(`ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''`);
}
if (!userColumns.some((column) => column.name === 'avatar_version')) {
  db.exec(`ALTER TABLE users ADD COLUMN avatar_version INTEGER NOT NULL DEFAULT 0`);
}
if (!userColumns.some((column) => column.name === 'avatar_type')) {
  db.exec(`ALTER TABLE users ADD COLUMN avatar_type TEXT`);
}

export function closeDb(): void {
  db.close();
}