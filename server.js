const crypto  = require('crypto');
const express = require('express');
const http    = require('http');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const helmet  = require('helmet');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);

// ── Security headers ───────────────────────────────────────────────────────────
// ── Security headers ───────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      // Add scriptSrcAttr to allow onclick handlers
      scriptSrcAttr: ["'unsafe-inline'"], 
      styleSrc:   ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '16kb' }));
app.use(express.static('public'));

// ── Health check for Render ────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Access key ─────────────────────────────────────────────────────────────────
// Set ACCESS_KEY in your environment (Render dashboard → Environment tab).
// Generate one with:  openssl rand -hex 32
// Give the value to users as a file:  echo -n "$ACCESS_KEY" > server.key
if (!process.env.ACCESS_KEY) {
  console.error('FATAL: ACCESS_KEY environment variable not set. Refusing to start.');
  process.exit(1);
}
const SERVER_KEY_BYTES = Buffer.from(process.env.ACCESS_KEY, 'utf8');

// ── JWT ────────────────────────────────────────────────────────────────────────
const JWT_SECRET = crypto.randomBytes(64).toString('hex');
const JWT_TTL    = '8h';

// ── Constants ──────────────────────────────────────────────────────────────────
const BCRYPT_ROUNDS     = 12;
const MAX_MSG_LENGTH    = 500;
const RATE_LIMIT_WINDOW = 5000;
const RATE_LIMIT_MAX    = 10;
const MAX_HISTORY       = 100;
const USERNAME_RE       = /^[a-zA-Z0-9_-]{3,20}$/;
const MIN_PASSWORD_LEN  = 8;

// ── In-memory stores ───────────────────────────────────────────────────────────
const accounts   = new Map(); // username.toLowerCase() → { username, passwordHash }
const userMap    = new Map(); // socket.id → username
const rateLimits = new Map(); // socket.id → { count, windowStart }
const history    = [];

// ── Helpers ────────────────────────────────────────────────────────────────────
function verifyKeyFile(base64Data) {
  try {
    const uploaded = Buffer.from(base64Data, 'base64');
    if (uploaded.length !== SERVER_KEY_BYTES.length) return false;
    return crypto.timingSafeEqual(uploaded, SERVER_KEY_BYTES);
  } catch { return false; }
}

function issueToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: JWT_TTL });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

function sanitise(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return (t && t.length <= MAX_MSG_LENGTH) ? t : null;
}

function checkRateLimit(id) {
  const now = Date.now();
  const r   = rateLimits.get(id) || { count: 0, windowStart: now };
  if (now - r.windowStart > RATE_LIMIT_WINDOW) { r.count = 1; r.windowStart = now; }
  else r.count++;
  rateLimits.set(id, r);
  return r.count <= RATE_LIMIT_MAX;
}

function pushHistory(entry) {
  if (history.length >= MAX_HISTORY) history.shift();
  history.push(entry);
}

// ── Auth routes ────────────────────────────────────────────────────────────────
app.post('/auth/register', async (req, res) => {
  const { username, password, keyFile } = req.body || {};

  if (!verifyKeyFile(keyFile))
    return res.status(403).json({ error: 'Invalid key file.' });
  if (!USERNAME_RE.test(username))
    return res.status(400).json({ error: 'Username must be 3–20 chars: letters, numbers, _ or -' });
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN)
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` });

  const key = username.toLowerCase();
  if (accounts.has(key))
    return res.status(409).json({ error: 'Username already taken.' });

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  accounts.set(key, { username, passwordHash });
  console.log(`Registered: ${username}`);

  res.json({ token: issueToken(username), username });
});

app.post('/auth/login', async (req, res) => {
  const { username, password, keyFile } = req.body || {};

  if (!verifyKeyFile(keyFile))
    return res.status(403).json({ error: 'Invalid key file.' });

  const key     = typeof username === 'string' ? username.toLowerCase() : '';
  const account = accounts.get(key);
  const hash    = account?.passwordHash ?? '$2a$12$invalidhashpaddingtomakethislong12345';
  const match   = await bcrypt.compare(password ?? '', hash);

  if (!account || !match)
    return res.status(401).json({ error: 'Invalid username or password.' });

  console.log(`Login: ${account.username}`);
  res.json({ token: issueToken(account.username), username: account.username });
});

// ── Socket.IO ──────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors:           { origin: false },
  pingTimeout:    6000,
  pingInterval:   4000,
  connectTimeout: 8000,
});

io.use((socket, next) => {
  const payload = verifyToken(socket.handshake.auth?.token);
  if (!payload) return next(new Error('Unauthorised'));
  socket.username = payload.username;
  next();
});

io.on('connection', (socket) => {
  const { username } = socket;

  // Kick any existing session for this user
  for (const [id, name] of userMap) {
    if (name === username && id !== socket.id) {
      io.to(id).emit('kicked', 'You were signed in from another location.');
      io.sockets.sockets.get(id)?.disconnect(true);
    }
  }

  userMap.set(socket.id, username);
  socket.emit('welcome', { username, history });
  console.log(`${username} connected (${io.engine.clientsCount} online)`);

  socket.on('chat message', (raw) => {
    if (!checkRateLimit(socket.id)) {
      socket.emit('error', 'Slow down — too many messages.');
      return;
    }
    const msg = sanitise(raw);
    if (!msg) {
      socket.emit('error', `Message must be 1–${MAX_MSG_LENGTH} characters.`);
      return;
    }
    const entry = { user: username, msg, ts: Date.now() };
    pushHistory(entry);
    io.emit('chat message', entry);
  });

  socket.on('disconnect', (reason) => {
    console.log(`${username} disconnected: ${reason}`);
    userMap.delete(socket.id);
    rateLimits.delete(socket.id);
  });
});

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Listening on port ${PORT}`));
