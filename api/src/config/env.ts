import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findApiRoot(start: string): string {
  let dir = start;
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Could not locate the api folder');
    dir = parent;
  }
  return dir;
}
const API_ROOT = findApiRoot(__dirname);

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === 'true';
}

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"');
}

const clientUrl = required('CLIENT_URL').replace(/\/+$/, '');

const cookieSameSiteValue = (process.env.COOKIE_SAMESITE || 'lax').trim().toLowerCase();
if (!['lax', 'strict', 'none'].includes(cookieSameSiteValue)) {
  throw new Error('COOKIE_SAMESITE must be one of: lax, strict, none');
}
const cookieSameSite = cookieSameSiteValue as 'lax' | 'strict' | 'none';

const cookieSecure = bool('COOKIE_SECURE', false);
if (cookieSameSite === 'none' && !cookieSecure) {
  throw new Error('COOKIE_SAMESITE=none requires COOKIE_SECURE=true');
}

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(API_ROOT, process.env.DATABASE_PATH)
  : path.resolve(API_ROOT, 'data', 'pingverse.db');

export const env = {
  port: Number(process.env.PORT) || 4000,
  databasePath,
  clientUrl,
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  cookieSecure,
  cookieSameSite,
  trustProxy: bool('TRUST_PROXY', false),
};