import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

const ISSUER = 'pingverse-api';

export function signSession(username: string): string {
  return jwt.sign({}, env.jwtSecret, {
    subject: username,
    issuer: ISSUER,
    expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'],
  });
}

export function verifySession(token: string | null | undefined): string | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret, { issuer: ISSUER });
    return typeof payload === 'string' ? null : payload.sub || null;
  } catch {
    return null;
  }
}