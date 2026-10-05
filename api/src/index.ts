import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { env } from './config/env.js';
import { closeDb } from './db/index.js';
import { helmetMiddleware, corsMiddleware } from './middleware/security.js';
import { attachUser, requireAuth } from './middleware/auth.js';
import { requireTrustedOrigin } from './middleware/security.js';
import { authRouter } from './routes/authRoutes.js';
import { createAdminRouter } from './routes/adminRoutes.js';
import { createSocketServer } from './sockets/index.js';
import { MessageModel } from './models/messageModel.js';
import { UserModel } from './models/userModel.js';
import { avatarPath, avatarExtensions, deleteAvatarFile, matchesAvatarType } from './utils/avatarStore.js';
import { usernameOnlySchema, safeParse } from './utils/validation.js';
import { errorMessage } from './utils/errors.js';

const mediaDirectory = path.resolve(path.dirname(env.databasePath), 'uploads');
fs.mkdirSync(mediaDirectory, { recursive: true });
const allowedMediaTypes = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm',
  'application/pdf',
]);
const mediaExtensions: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/wav': '.wav',
  'audio/ogg': '.ogg', 'audio/webm': '.webm', 'application/pdf': '.pdf',
};
const mediaName = (value: unknown) => path.basename(String(value || 'file').replace(/[\\/]/g, '_')).replace(/[<>:"|?*\x00-\x1f]/g, '_').slice(0, 180) || 'file';
function matchesMediaType(buffer: Buffer, type: string) {
  const ascii = (start: number, end: number) => buffer.subarray(start, end).toString('ascii');
  if (type === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (type === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/gif') return ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  if (type === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (type === 'video/mp4') return ascii(4, 8) === 'ftyp';
  if (type === 'video/webm' || type === 'audio/webm') return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (type === 'audio/mpeg') return ascii(0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  if (type === 'audio/wav') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
  if (type === 'audio/ogg') return ascii(0, 4) === 'OggS';
  if (type === 'application/pdf') return ascii(0, 5) === '%PDF-';
  return false;
}

const app = express();

if (env.trustProxy) app.set('trust proxy', 1);

app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(express.json({ limit: '16kb' }));
app.use(attachUser);

app.post('/media/upload', requireTrustedOrigin, requireAuth, express.raw({ type: 'application/octet-stream', limit: '10mb' }), (req, res) => {
  const type = String(req.get('x-file-type') || '').split(';')[0].trim().toLowerCase();
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'The selected file is empty.' });
  if (req.body.length > 10 * 1024 * 1024) return res.status(413).json({ error: 'Files must be 10 MB or smaller.' });

  const safeInlineType = allowedMediaTypes.has(type) && matchesMediaType(req.body, type) ? type : 'application/octet-stream';
  const id = randomUUID();
  const name = mediaName(req.query.name);
  const diskPath = path.join(mediaDirectory, `${id}${mediaExtensions[safeInlineType] || '.bin'}`);
  try {
    fs.writeFileSync(diskPath, req.body, { flag: 'wx' });
    MessageModel.registerUploadedMedia({ id, owner: req.user!.username, name, type: safeInlineType, size: req.body.length });
    res.status(201).json({ attachment: { id, name, type: safeInlineType, size: req.body.length } });
  } catch (error) {
    try { fs.unlinkSync(diskPath); } catch { }
    console.error('[media] upload failed:', errorMessage(error));
    res.status(500).json({ error: 'The file could not be uploaded.' });
  }
});

app.get('/media/:id', requireAuth, (req, res) => {
  const id = req.params.id as string;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.sendStatus(404);
  const media = MessageModel.findAuthorizedMedia(id, req.user!.username);
  if (!media) return res.sendStatus(404);
  const extension = mediaExtensions[media.type] || '.bin';
  const filePath = path.join(mediaDirectory, `${media.id}${extension}`);
  const fallbackName = media.name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const disposition = media.type.startsWith('image/') || media.type.startsWith('video/') || media.type.startsWith('audio/') ? 'inline' : 'attachment';
  res.set({ 'Content-Type': media.type, 'Content-Length': String(media.size), 'Content-Disposition': `${disposition}; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(media.name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
  res.sendFile(filePath, (error) => { if (error && !res.headersSent) res.sendStatus((error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500); });
});

const allowedAvatarTypes = new Set(Object.keys(avatarExtensions));

app.post('/profile/avatar', requireTrustedOrigin, requireAuth, express.raw({ type: 'application/octet-stream', limit: '2mb' }), (req, res) => {
  const type = String(req.get('x-file-type') || '').split(';')[0].trim().toLowerCase();
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'The selected image is empty.' });
  if (req.body.length > 2 * 1024 * 1024) return res.status(413).json({ error: 'Avatars must be 2 MB or smaller.' });
  if (!allowedAvatarTypes.has(type) || !matchesAvatarType(req.body, type)) return res.status(400).json({ error: 'Avatars must be a JPEG, PNG, GIF or WebP image.' });

  const username = req.user!.username;
  const existing = UserModel.findByUsername(username);
  deleteAvatarFile(username, existing?.avatar_type || null);
  const version = (existing?.avatar_version || 0) + 1;
  try {
    fs.writeFileSync(avatarPath(username, type), req.body);
    UserModel.setAvatar(username, version, type);
    res.status(201).json({ avatarVersion: version, avatarType: type });
  } catch (error) {
    console.error('[profile] avatar upload failed:', errorMessage(error));
    res.status(500).json({ error: 'The avatar could not be uploaded.' });
  }
});

app.get('/profile/avatar/:username', requireAuth, (req, res) => {
  const parsed = safeParse(usernameOnlySchema, req.params.username);
  if (!parsed.ok) return res.sendStatus(404);
  const user = UserModel.findByUsername(parsed.data);
  if (!user || !user.avatar_type) return res.sendStatus(404);
  res.set({ 'Content-Type': user.avatar_type, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
  res.sendFile(avatarPath(user.username, user.avatar_type), (error) => { if (error && !res.headersSent) res.sendStatus((error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500); });
});

app.get('/profile/:username', requireAuth, (req, res) => {
  const parsed = safeParse(usernameOnlySchema, req.params.username);
  if (!parsed.ok) return res.status(404).json({ error: 'User not found' });
  const user = UserModel.findByUsername(parsed.data);
  if (!user || user.status !== 'approved') return res.status(404).json({ error: 'User not found' });
  res.json({ username: user.username, role: user.role, bio: user.bio, createdAt: user.created_at, hasAvatar: Boolean(user.avatar_type), avatarVersion: user.avatar_version });
});

const server = http.createServer(app);
const io = createSocketServer(server);

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/auth', authRouter);
app.use('/admin', createAdminRouter(io));

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const errorType = (err as { type?: string } | null)?.type;
  if (errorType === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  if (errorType === 'entity.too.large') return res.status(413).json({ error: 'Files must be 10 MB or smaller.' });
  console.error('Unhandled API error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

server.listen(env.port, () => {
  console.log(`Pingverse API listening on port ${env.port}`);
  console.log(`Accepting requests from: ${env.clientUrl}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down...`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));