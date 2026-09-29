import type { Request, Response, NextFunction } from 'express';
import { readSessionToken } from '../utils/cookies.js';
import { verifySession } from '../utils/jwt.js';
import { UserModel } from '../models/userModel.js';

/**
 * Attaches req.user = { username, role } when the session cookie is valid
 * AND the account still exists and is approved. Role comes from the
 * database on every request (never from the token). Never blocks the
 * request - use requireAuth / requireAdmin for protected routes.
 */
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  req.user = null;
  const username = verifySession(readSessionToken(req.headers.cookie));
  if (username) {
    const user = UserModel.findByUsername(username);
    if (user && user.status === 'approved') {
      req.user = { username: user.username, role: user.role };
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}
