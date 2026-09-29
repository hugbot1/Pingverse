import { Router, type Request, type Response } from 'express';
import type { z } from 'zod';
import { UserModel, type UserRecord } from '../models/userModel.js';
import { MessageModel } from '../models/messageModel.js';
import { AnnouncementModel } from '../models/announcementModel.js';
import { AuditModel } from '../models/auditModel.js';
import { presence } from '../sockets/presence.js';
import type { AppServer } from '../sockets/types.js';
import { requireAdmin } from '../middleware/auth.js';
import { requireStrictOrigin } from '../middleware/security.js';
import { adminLimiter } from '../middleware/rateLimit.js';
import {
  adminUserSchema,
  adminTimeoutSchema,
  adminMessageSchema,
  announcementSchema,
  safeParse,
} from '../utils/validation.js';

/**
 * Every admin action lives here and nowhere else. All routes require a
 * valid session whose account is currently an approved admin (checked
 * against the database on each request), a strictly matching Origin on
 * every state-changing call, and are rate limited and audit-logged.
 *
 * Admin accounts themselves can never be modified from here - roles are
 * only ever changed by editing the database directly.
 */
export function createAdminRouter(io: AppServer) {
  const router = Router();

  router.use(adminLimiter);
  router.use(requireAdmin);
  router.use((req, res, next) => (req.method === 'POST' ? requireStrictOrigin(req, res, next) : next()));

  function audit(req: Request, action: string, target: string | null = null, detail: string | null = null) {
    AuditModel.log(req.user!.username, action, target, detail);
  }

  /** Validates the body and loads a non-admin target account, or responds with an error. */
  function loadTarget<T extends { username: string }>(
    req: Request,
    res: Response,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>
  ): { user: UserRecord; data: T } | null {
    const parsed = safeParse(schema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return null;
    }
    const user = UserModel.findByUsername(parsed.data.username);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return null;
    }
    if (user.role === 'admin') {
      res.status(403).json({ error: 'Admin accounts cannot be modified from the panel' });
      return null;
    }
    return { user, data: parsed.data };
  }

  function socketsOf(username: string) {
    return [...io.sockets.sockets.values()].filter((s) => s.user && s.user.username === username);
  }

  // ---------- reads ----------

  router.get('/users', (_req, res) => {
    res.json(
      UserModel.listAll().map((u) => ({
        username: u.username,
        role: u.role,
        status: u.status,
        mutedUntil: u.muted_until,
        createdAt: u.created_at,
      }))
    );
  });

  router.get('/messages', (_req, res) => {
    res.json(MessageModel.recentGlobal(100));
  });

  router.get('/audit', (_req, res) => {
    res.json(AuditModel.recent(50));
  });

  // ---------- account approval ----------

  router.post('/users/approve', (req, res) => {
    const found = loadTarget(req, res, adminUserSchema);
    if (!found) return;
    if (found.user.status !== 'pending') {
      return res.status(400).json({ error: 'That account is not pending approval' });
    }
    UserModel.setStatus(found.user.username, 'approved');
    audit(req, 'approve_user', found.user.username);
    io.emit('status change');
    res.json({ ok: true });
  });

  // Rejecting removes the pending account entirely so the name is free again.
  router.post('/users/reject', (req, res) => {
    const found = loadTarget(req, res, adminUserSchema);
    if (!found) return;
    if (found.user.status !== 'pending') {
      return res.status(400).json({ error: 'That account is not pending approval' });
    }
    UserModel.deleteByUsername(found.user.username);
    audit(req, 'reject_user', found.user.username);
    res.json({ ok: true });
  });

  // ---------- moderation of approved accounts ----------

  router.post('/users/timeout', (req, res) => {
    const found = loadTarget(req, res, adminTimeoutSchema);
    if (!found) return;
    if (found.user.status !== 'approved') {
      return res.status(400).json({ error: 'Only approved accounts can be timed out' });
    }
    const until = Date.now() + found.data.mins * 60_000;
    UserModel.setMutedUntil(found.user.username, until);
    audit(req, 'timeout_user', found.user.username, `${found.data.mins} min`);
    io.emit('user status alert', { target: found.user.username, muted: true, until });
    res.json({ ok: true });
  });

  router.post('/users/untimeout', (req, res) => {
    const found = loadTarget(req, res, adminUserSchema);
    if (!found) return;
    UserModel.setMutedUntil(found.user.username, null);
    audit(req, 'untimeout_user', found.user.username);
    io.emit('user status alert', { target: found.user.username, muted: false, until: null });
    res.json({ ok: true });
  });

  router.post('/users/delete', (req, res) => {
    const found = loadTarget(req, res, adminUserSchema);
    if (!found) return;
    const name = found.user.username;

    MessageModel.deleteByUsername(name);
    UserModel.deleteByUsername(name);
    presence.remove(name);
    audit(req, 'delete_user', name);

    for (const s of socketsOf(name)) {
      s.emit('force logout');
      setTimeout(() => s.disconnect(true), 250);
    }
    io.emit('user purged', name);
    io.emit('status change');
    res.json({ ok: true });
  });

  // ---------- site-wide content ----------

  router.post('/announcement', (req, res) => {
    const parsed = safeParse(announcementSchema, req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const saved = AnnouncementModel.set(parsed.data.msg, parsed.data.important);
    audit(req, 'set_announcement', null, parsed.data.msg || '(cleared)');
    io.emit('announcement', saved);
    res.json({ ok: true });
  });

  router.post('/chat/clear', (req, res) => {
    MessageModel.deleteGlobalHistory();
    audit(req, 'clear_global_chat');
    io.emit('chat cleared');
    res.json({ ok: true });
  });

  // Only public (global) messages can be moderated here; DMs stay private.
  router.post('/messages/delete', (req, res) => {
    const parsed = safeParse(adminMessageSchema, req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const msg = MessageModel.findById(parsed.data.id);
    if (!msg || msg.to !== 'global') return res.status(404).json({ error: 'Message not found' });

    MessageModel.deleteById(parsed.data.id);
    audit(req, 'delete_message', msg.user, msg.msg.slice(0, 80));
    io.emit('msg deleted', msg.id);
    res.json({ ok: true });
  });

  return router;
}
