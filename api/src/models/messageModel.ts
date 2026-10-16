import { db } from '../db/index.js';

type MessageRow = {
  id: number | bigint;
  user: string;
  msg: string;
  attachments: string;
  role: string;
  to_user: string;
  reply_to: string | null;
  forwarded_from: string | null;
  edited: number;
  is_read: number;
  yeahs: string;
  reactions: string;
  poll: string | null;
  pinned_by?: string | null;
  pinned_at?: number | null;
  saved_message_id?: number | null;
  saved_at?: number | null;
  ts: number;
};

type MediaRecord = { id: string; owner: string; name: string; type: string; size: number };

export type MessageId = string | number;
export type Attachment = { id: string; name: string; type: string; size: number };
export type ReplyTo = { id: MessageId; user: string; text: string };
export type ForwardedFrom = { user: string };
export type PinInfo = { pinned_by: string; pinned_at: number };
export type PollOption = { text: string; votes: string[] };
export type Poll = { question: string; options: PollOption[]; multi: boolean; closed: boolean };

export type Message = {
  id: string;
  user: string;
  msg: string;
  attachments: Attachment[];
  role: string;
  to: string;
  replyTo: ReplyTo | null;
  forwardedFrom: ForwardedFrom | null;
  edited: boolean;
  read: boolean;
  yeahs: string[];
  reactions: Record<string, string[]>;
  poll: Poll | null;
  pinned: boolean;
  pinnedBy: string | null;
  pinnedAt: number | null;
  saved: boolean;
  savedAt: number | null;
  ts: number;
};

export type CreateMessageInput = {
  user: string;
  msg: string;
  attachments?: Attachment[];
  role: string;
  to?: string;
  replyTo?: ReplyTo | null;
  forwardedFrom?: ForwardedFrom | null;
  poll?: Poll | null;
};

export type SearchInput = {
  username: string;
  to: string;
  query?: string;
  author?: string;
  sort?: 'old' | 'new';
  limit?: number;
};

const insertMessage = db.prepare(`
  INSERT INTO messages (user, msg, attachments, role, to_user, reply_to, forwarded_from, edited, is_read, yeahs, reactions, poll, ts)
  VALUES (@user, @msg, @attachments, @role, @to_user, @reply_to, @forwarded_from, 0, 0, '[]', '{}', @poll, @ts)
`);

const findById = db.prepare(`SELECT * FROM messages WHERE id = ?`);
const insertUploadedMedia = db.prepare(`INSERT INTO uploaded_media (id, owner, name, type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
const findUploadedMedia = db.prepare(`SELECT * FROM uploaded_media WHERE id=? AND owner=?`);
const findAuthorizedMedia = db.prepare(`
  SELECT u.* FROM uploaded_media u
  WHERE u.id=? AND EXISTS (
    SELECT 1 FROM messages m, json_each(m.attachments) a
    WHERE json_extract(a.value, '$.id')=u.id AND (m.to_user='global' OR m.user=? OR m.to_user=?)
  )
`);

const findRelevantToUser = db.prepare(`
  SELECT m.*, p.pinned_by, p.pinned_at, s.message_id AS saved_message_id
  FROM messages m
  LEFT JOIN message_pins p ON p.message_id = m.id
  LEFT JOIN saved_messages s ON s.message_id = m.id AND s.username = @username
  WHERE m.to_user = 'global' OR m.to_user = @username OR m.user = @username
  ORDER BY m.ts DESC
  LIMIT @limit
`);
const listPinsGlobal = db.prepare(`SELECT m.*, p.pinned_by, p.pinned_at FROM message_pins p JOIN messages m ON m.id=p.message_id WHERE m.to_user='global' ORDER BY p.pinned_at DESC`);
const listPinsPrivate = db.prepare(`SELECT m.*, p.pinned_by, p.pinned_at FROM message_pins p JOIN messages m ON m.id=p.message_id WHERE (m.user=? AND m.to_user=?) OR (m.user=? AND m.to_user=?) ORDER BY p.pinned_at DESC`);
const listSaved = db.prepare(`SELECT m.*, s.message_id AS saved_message_id, s.saved_at FROM saved_messages s JOIN messages m ON m.id=s.message_id WHERE s.username=? ORDER BY s.saved_at DESC`);
const searchMessages = db.prepare(`
  SELECT m.*, p.pinned_by, p.pinned_at, s.message_id AS saved_message_id
  FROM messages m
  LEFT JOIN message_pins p ON p.message_id=m.id
  LEFT JOIN saved_messages s ON s.message_id=m.id AND s.username=@username
  WHERE ((@to='global' AND m.to_user='global') OR
    (@to<>'global' AND ((m.user=@username AND m.to_user=@to) OR (m.user=@to AND m.to_user=@username))))
    AND (@query='' OR instr(lower(m.msg), lower(@query)) > 0)
    AND (@author='' OR instr(lower(m.user), lower(@author)) > 0)
  ORDER BY CASE WHEN @sort='old' THEN m.ts END ASC, CASE WHEN @sort='new' THEN m.ts END DESC
  LIMIT @limit
`);
const findPin = db.prepare(`SELECT pinned_by, pinned_at FROM message_pins WHERE message_id=?`);
const insertPin = db.prepare(`INSERT INTO message_pins(message_id,pinned_by,pinned_at) VALUES(?,?,?)`);
const removePin = db.prepare(`DELETE FROM message_pins WHERE message_id=?`);
const findSaved = db.prepare(`SELECT 1 FROM saved_messages WHERE username=? AND message_id=?`);
const insertSaved = db.prepare(`INSERT INTO saved_messages(username,message_id,saved_at) VALUES(?,?,?)`);
const removeSaved = db.prepare(`DELETE FROM saved_messages WHERE username=? AND message_id=?`);

const findRecentGlobal = db.prepare(`
  SELECT * FROM messages WHERE to_user = 'global' ORDER BY ts DESC LIMIT ?
`);

const updateYeahs = db.prepare(`UPDATE messages SET yeahs = ? WHERE id = ?`);
const updateReactions = db.prepare(`UPDATE messages SET reactions = ? WHERE id = ?`);
const updatePoll = db.prepare(`UPDATE messages SET poll = ? WHERE id = ?`);
const updateEdited = db.prepare(`UPDATE messages SET msg = ?, edited = 1 WHERE id = ?`);
const deleteGlobal = db.prepare(`DELETE FROM messages WHERE to_user = 'global'`);
const deleteById = db.prepare(`DELETE FROM messages WHERE id = ?`);
const deleteByUsername = db.prepare(`DELETE FROM messages WHERE user = ? OR to_user = ?`);
const deleteSavedByUsername = db.prepare(`DELETE FROM saved_messages WHERE username=?`);
const renameSavedUsername = db.prepare(`UPDATE saved_messages SET username=? WHERE username=?`);
const renamePinActor = db.prepare(`UPDATE message_pins SET pinned_by=? WHERE pinned_by=?`);
const renameSender = db.prepare(`UPDATE messages SET user = ? WHERE user = ?`);
const renameRecipient = db.prepare(`UPDATE messages SET to_user = ? WHERE to_user = ?`);
const markThreadRead = db.prepare(`
  UPDATE messages SET is_read = 1 WHERE user = @sender AND to_user = @recipient AND is_read = 0
`);
const unreadCountsFor = db.prepare(`
  SELECT user AS sender, COUNT(*) AS count
  FROM messages
  WHERE to_user = ? AND is_read = 0
  GROUP BY user
`);

function serialize(row: MessageRow): Message;
function serialize(row: MessageRow | undefined): Message | null;
function serialize(row: MessageRow | undefined): Message | null {
  if (!row) return null;
  return {
    id: String(row.id),
    user: row.user,
    msg: row.msg,
    attachments: JSON.parse(row.attachments || '[]'),
    role: row.role,
    to: row.to_user,
    replyTo: row.reply_to ? JSON.parse(row.reply_to) : null,
    forwardedFrom: row.forwarded_from ? JSON.parse(row.forwarded_from) : null,
    edited: Boolean(row.edited),
    read: Boolean(row.is_read),
    yeahs: JSON.parse(row.yeahs || '[]'),
    reactions: JSON.parse(row.reactions || '{}'),
    poll: row.poll ? JSON.parse(row.poll) : null,
    pinned: Boolean(row.pinned_by),
    pinnedBy: row.pinned_by || null,
    pinnedAt: row.pinned_at || null,
    saved: Boolean(row.saved_message_id),
    savedAt: row.saved_at || null,
    ts: row.ts,
  };
}

const asRow = (row: unknown) => row as MessageRow | undefined;
const asRows = (rows: unknown) => rows as MessageRow[];

export const MessageModel = {
  create({ user, msg, attachments = [], role, to, replyTo, forwardedFrom, poll }: CreateMessageInput): Message {
    const info = insertMessage.run({
      user,
      msg,
      attachments: JSON.stringify(attachments),
      role,
      to_user: to || 'global',
      reply_to: replyTo ? JSON.stringify(replyTo) : null,
      forwarded_from: forwardedFrom ? JSON.stringify(forwardedFrom) : null,
      poll: poll ? JSON.stringify(poll) : null,
      ts: Date.now(),
    });
    return serialize(asRow(findById.get(info.lastInsertRowid))!);
  },

  findById(id: MessageId): Message | null {
    return serialize(asRow(findById.get(id)));
  },

  registerUploadedMedia(media: { id: string; owner: string; name: string; type: string; size: number }): void {
    insertUploadedMedia.run(media.id, media.owner, media.name, media.type, media.size, Date.now());
  },

  findUploadedMedia(id: string, owner: string): Attachment | null {
    const media = findUploadedMedia.get(id, owner) as unknown as MediaRecord | undefined;
    return media ? { id: media.id, name: media.name, type: media.type, size: media.size } : null;
  },

  findAuthorizedMedia(id: string, username: string): MediaRecord | null {
    return (findAuthorizedMedia.get(id, username, username) as unknown as MediaRecord | undefined) || null;
  },

  historyForUser(username: string, limit = 150): Message[] {
    const rows = asRows(findRelevantToUser.all({ username, limit }));
    return rows.reverse().map((row) => serialize(row));
  },

  recentGlobal(limit = 100): Message[] {
    return asRows(findRecentGlobal.all(limit)).map((row) => serialize(row));
  },

  pinsForConversation(to: string, username: string): Message[] {
    const rows = asRows(to === 'global' ? listPinsGlobal.all() : listPinsPrivate.all(username, to, to, username));
    return rows.map((row) => serialize(row));
  },

  savedForUser(username: string): Message[] {
    return asRows(listSaved.all(username)).map((row) => serialize(row));
  },

  search({ username, to, query, author, sort = 'new', limit = 200 }: SearchInput): Message[] {
    const rows = asRows(searchMessages.all({
      username, to, query: query || '', author: author || '',
      sort: sort === 'old' ? 'old' : 'new', limit: Math.min(200, Math.max(1, limit)),
    }));
    return rows.map((row) => serialize(row));
  },

  pinInfo(id: MessageId): PinInfo | null { return (findPin.get(id) as unknown as PinInfo | undefined) || null; },

  togglePin(id: MessageId, username: string): PinInfo | null {
    const current = findPin.get(id);
    if (current) { removePin.run(id); return null; }
    insertPin.run(id, username, Date.now());
    return (findPin.get(id) as unknown as PinInfo | undefined) || null;
  },

  toggleSaved(id: MessageId, username: string): boolean {
    if (findSaved.get(username, id)) { removeSaved.run(username, id); return false; }
    insertSaved.run(username, id, Date.now());
    return true;
  },

  toggleYeah(id: MessageId, username: string): Message | null {
    const row = findById.get(id) as unknown as { yeahs: string } | undefined;
    if (!row) return null;
    const yeahs: string[] = JSON.parse(row.yeahs || '[]');
    const idx = yeahs.indexOf(username);
    if (idx === -1) yeahs.push(username);
    else yeahs.splice(idx, 1);
    updateYeahs.run(JSON.stringify(yeahs), id);
    return serialize(asRow(findById.get(id)));
  },

  toggleReaction(id: MessageId, username: string, emoji: string): Message | null {
    const row = findById.get(id) as unknown as { reactions: string } | undefined;
    if (!row) return null;
    const reactions: Record<string, string[]> = JSON.parse(row.reactions || '{}');
    const users = Array.isArray(reactions[emoji]) ? reactions[emoji] : [];
    const index = users.indexOf(username);
    if (index === -1) users.push(username);
    else users.splice(index, 1);
    if (users.length) reactions[emoji] = users;
    else delete reactions[emoji];
    updateReactions.run(JSON.stringify(reactions), id);
    return serialize(asRow(findById.get(id)));
  },

  votePoll(id: MessageId, username: string, optionIndex: number): Message | null {
    const row = findById.get(id) as unknown as { poll: string | null } | undefined;
    if (!row?.poll) return null;
    const poll: Poll = JSON.parse(row.poll);
    const option = poll.options[optionIndex];
    if (poll.closed || !option) return null;
    const had = option.votes.includes(username);
    if (poll.multi) {
      option.votes = had ? option.votes.filter((voter) => voter !== username) : [...option.votes, username];
    } else {
      for (const other of poll.options) other.votes = other.votes.filter((voter) => voter !== username);
      if (!had) option.votes.push(username);
    }
    updatePoll.run(JSON.stringify(poll), id);
    return serialize(asRow(findById.get(id)));
  },

  closePoll(id: MessageId): Message | null {
    const row = findById.get(id) as unknown as { poll: string | null } | undefined;
    if (!row?.poll) return null;
    const poll: Poll = JSON.parse(row.poll);
    poll.closed = true;
    updatePoll.run(JSON.stringify(poll), id);
    return serialize(asRow(findById.get(id)));
  },

  editMessage(id: MessageId, newMsg: string): Message | null {
    updateEdited.run(newMsg, id);
    return serialize(asRow(findById.get(id)));
  },

  deleteGlobalHistory(): void {
    deleteGlobal.run();
  },

  deleteById(id: MessageId): void {
    deleteById.run(id);
  },

  deleteByUsername(username: string): void {
    deleteSavedByUsername.run(username);
    deleteByUsername.run(username, username);
  },

  renameUsername(oldUsername: string, newUsername: string): void {
    renameSavedUsername.run(newUsername, oldUsername);
    renamePinActor.run(newUsername, oldUsername);
    renameSender.run(newUsername, oldUsername);
    renameRecipient.run(newUsername, oldUsername);
  },

  markThreadRead(sender: string, recipient: string): void {
    markThreadRead.run({ sender, recipient });
  },

  unreadCountsFor(recipient: string): Record<string, number> {
    const rows = unreadCountsFor.all(recipient) as unknown as { sender: string; count: number }[];
    const map: Record<string, number> = {};
    for (const row of rows) map[row.sender] = row.count;
    return map;
  },
};