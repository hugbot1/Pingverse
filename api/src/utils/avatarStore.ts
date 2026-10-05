import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

export const avatarsDirectory = path.resolve(path.dirname(env.databasePath), 'avatars');
fs.mkdirSync(avatarsDirectory, { recursive: true });

export const avatarExtensions: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

export function avatarPath(username: string, type: string): string {
  return path.join(avatarsDirectory, `${username}${avatarExtensions[type] || ''}`);
}

export function deleteAvatarFile(username: string, type: string | null): void {
  if (!type) return;
  try {
    fs.unlinkSync(avatarPath(username, type));
  } catch {
    // already gone
  }
}

export function matchesAvatarType(buffer: Buffer, type: string): boolean {
  const ascii = (start: number, end: number) => buffer.subarray(start, end).toString('ascii');
  if (type === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (type === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/gif') return ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  if (type === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  return false;
}