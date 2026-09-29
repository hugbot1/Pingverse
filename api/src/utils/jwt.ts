import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

const ISSUER = 'pingverse-api';

// The token only proves *who* the caller is. Role and approval status are
// always looked up in the database on every request, so a demotion,
// deletion or un-approval takes effect immediately.
export function signSession(username: string): string {
  return jwt.sign({}, env.jwtSecret, {
    subject: username,
    issuer: ISSUER,
    expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'],
  });
}

/** Verifies a session token and returns the username, or null. */
export function verifySession(token: string | null | undefined): string | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret, { issuer: ISSUER });
    return typeof payload === 'string' ? null : payload.sub || null;
  } catch {
    return null;
  }
}
