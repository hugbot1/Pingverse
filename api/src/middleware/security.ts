import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from '../config/env.js';

// The API only ever returns JSON, so a strict "deny everything" CSP is
// appropriate here - it's just defense in depth in case someone ever
// browses to an API URL directly.
export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
});

export const corsMiddleware = cors({
  origin: env.clientUrl,
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-File-Type'],
});

/**
 * Defense-in-depth CSRF check for cookie-authenticated, state-changing
 * requests: reject anything whose Origin (or, failing that, Referer)
 * header doesn't match the configured frontend origin.
 */
export function requireTrustedOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.get('origin');
  if (origin) {
    if (origin !== env.clientUrl) {
      return res.status(403).json({ error: 'Untrusted origin' });
    }
    return next();
  }
  const referer = req.get('referer');
  if (referer && !referer.startsWith(env.clientUrl + '/') && referer !== env.clientUrl) {
    return res.status(403).json({ error: 'Untrusted origin' });
  }
  next();
}

/**
 * Stricter variant used for admin actions: the Origin header MUST be
 * present and match. Browsers always send Origin on cross-origin POSTs
 * from the admin panel, so only non-browser callers (curl, scripts) that
 * omit it are rejected.
 */
export function requireStrictOrigin(req: Request, res: Response, next: NextFunction) {
  if (req.get('origin') !== env.clientUrl) {
    return res.status(403).json({ error: 'Untrusted origin' });
  }
  next();
}
