import { db } from '../db/index.js';

export type UserRecord = {
  id: number;
  username: string;
  hash: string;
  role: string;
  status: string;
  muted_until: number | null;
  created_at: number;
};

export type UserListing = Pick<UserRecord, 'username' | 'role' | 'status' | 'muted_until' | 'created_at'>;
export type ApprovedUser = Pick<UserRecord, 'username' | 'role' | 'muted_until'>;

const insertUser = db.prepare(
  `INSERT INTO users (username, hash, role, status, created_at) VALUES (@username, @hash, @role, @status, @created_at)`
);
const findByUsername = db.prepare(`SELECT * FROM users WHERE username = ?`);
const listAll = db.prepare(
  `SELECT username, role, status, muted_until, created_at FROM users ORDER BY created_at ASC`
);
const listApproved = db.prepare(
  `SELECT username, role, muted_until FROM users WHERE status = 'approved'`
);
const countPending = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE status = 'pending'`);
const updateStatus = db.prepare(`UPDATE users SET status = ? WHERE username = ?`);
const updateRole = db.prepare(`UPDATE users SET role = ? WHERE username = ?`);
const updateMutedUntil = db.prepare(`UPDATE users SET muted_until = ? WHERE username = ?`);
const updateCredentials = db.prepare(
  `UPDATE users SET username = COALESCE(@newUsername, username), hash = COALESCE(@newHash, hash) WHERE username = @currentUsername`
);
const deleteByUsername = db.prepare(`DELETE FROM users WHERE username = ?`);

export const UserModel = {
  createPending({ username, hash }: { username: string; hash: string }): void {
    const created_at = Date.now();
    insertUser.run({ username, hash, role: 'user', status: 'pending', created_at });
  },

  findByUsername(username: string): UserRecord | null {
    return (findByUsername.get(username) as unknown as UserRecord | undefined) || null;
  },

  exists(username: string): boolean {
    return Boolean(findByUsername.get(username));
  },

  listAll(): UserListing[] {
    return listAll.all() as unknown as UserListing[];
  },

  listApproved(): ApprovedUser[] {
    return listApproved.all() as unknown as ApprovedUser[];
  },

  countPending(): number {
    return Number((countPending.get() as unknown as { n: number }).n);
  },

  setStatus(username: string, status: string): void {
    updateStatus.run(status, username);
  },

  setRole(username: string, role: string): void {
    updateRole.run(role, username);
  },

  setMutedUntil(username: string, untilMs: number | null): void {
    updateMutedUntil.run(untilMs, username);
  },

  updateCredentials(
    currentUsername: string,
    { newUsername, newHash }: { newUsername?: string | null; newHash?: string | null }
  ): void {
    updateCredentials.run({
      currentUsername,
      newUsername: newUsername || null,
      newHash: newHash || null,
    });
  },

  deleteByUsername(username: string): void {
    deleteByUsername.run(username);
  },
};