import { parse as parseCookieHeader, serialize as serializeCookie } from 'cookie';
import { env } from '../config/env.js';

export const SESSION_COOKIE = 'pingverse_session';

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function readSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const cookies = parseCookieHeader(cookieHeader);
  return cookies[SESSION_COOKIE] || null;
}

export function buildSessionCookie(token: string): string {
  return serializeCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: '/',
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });
}

export function buildClearedSessionCookie(): string {
  return serializeCookie(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: '/',
    maxAge: 0,
  });
}