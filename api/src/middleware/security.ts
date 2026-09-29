import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from '../config/env.js';

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

export function requireStrictOrigin(req: Request, res: Response, next: NextFunction) {
  if (req.get('origin') !== env.clientUrl) {
    return res.status(403).json({ error: 'Untrusted origin' });
  }
  next();
}