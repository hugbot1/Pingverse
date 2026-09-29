import { db } from '../db/index.js';

export type AuditEntry = {
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
  ts: number;
};

const insert = db.prepare(
  `INSERT INTO audit_log (actor, action, target, detail, ts) VALUES (?, ?, ?, ?, ?)`
);
const recent = db.prepare(`SELECT actor, action, target, detail, ts FROM audit_log ORDER BY id DESC LIMIT ?`);

export const AuditModel = {
  log(actor: string, action: string, target: string | null = null, detail: string | null = null): void {
    insert.run(actor, action, target, detail, Date.now());
  },

  recent(limit = 50): AuditEntry[] {
    return (recent.all(limit) as unknown as AuditEntry[]).map((r) => ({ ...r }));
  },
};
