const crypto  = require('crypto');
const express = require('express');
const http    = require('http');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const helmet  = require('helmet');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '16kb' }));
app.use(express.static('public'));

// ── Health check (used by Render to confirm the service is up) ────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Key ──────────────────────────────────────────────────────────────────────
// The access key lives ONLY in the environment — never in source code.
// Generate one and start the server like this:
//
//   ACCESS_KEY="$(openssl rand -hex 32)" node server.js
//
// Then create the key file you hand to users (must match exactly):
//   echo -n "$ACCESS_KEY" > server.key
//
// Never commit ACCESS_KEY to git. Add it to .gitignore / .env and keep
// it out of logs — process.env values are not visible in source but can
// be read from /proc on Linux if someone has shell access, so treat it
// like a password.
if (!process.env.ACCESS_KEY) {
  console.error('FATAL: ACCESS_KEY environment variable is not set. Refusing to start.');
  process.exit(1);
}
const SERVER_KEY_BYTES = Buffer.from(process.env.ACCESS_KEY, 'utf8');

// ── JWT secret (separate from the key file) ───────────────────────────────────
const JWT_SECRET = crypto.randomBytes(64).toString('hex');
const JWT_TTL    = '8h';

// ── Constants ─────────────────────────────────────────────────────────────────
const BCRYPT_ROUNDS     = 12;
const MAX_MSG_LENGTH    = 500;
const RATE_LIMIT_WINDOW = 5000;
const RATE_LIMIT_MAX    = 10;
const MAX_HISTORY       = 100;

// Username rules: 3-20 chars, letters/digits/underscores/hyphens only
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;
// Password rules: 8+ chars
const MIN_PASSWORD_LEN = 8;

// ── In-memory stores ──────────────────────────────────────────────────────────
// accounts: username (lowercase) → { username, passwordHash }
const accounts   = new Map();
// active sockets: socket.id → username
const userMap    = new Map();
const rateLimits = new Map();
const history    = [];

// ── Helpers ───────────────────────────────────────────────────────────────────
function timingSafeEqual(a, b) {
  // Compare Buffers of the same length in constant time
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyKeyFile(base64Data) {
  try {
    const uploaded = Buffer.from(base64Data, 'base64');
    return timingSafeEqual(uploaded, SERVER_KEY_BYTES);
  } catch {
    return false;
  }
}

function issueToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: JWT_TTL });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET); // { username, iat, exp }
  } catch {
    return null;
  }
}

function sanitise(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  if (!trimmed || trimmed.length > MAX_MSG_LENGTH) return null;
  return trimmed;
}

function checkRateLimit(socketId) {
  const now = Date.now();
  const rec = rateLimits.get(socketId) || { count: 0, windowStart: now };
  if (now - rec.windowStart > RATE_LIMIT_WINDOW) {
    rec.count = 1; rec.windowStart = now;
  } else {
    rec.count++;
  }
  rateLimits.set(socketId, rec);
  return rec.count <= RATE_LIMIT_MAX;
}

function pushHistory(entry) {
  if (history.length >= MAX_HISTORY) history.shift();
  history.push(entry);
}

// ── Auth routes ───────────────────────────────────────────────────────────────

// POST /auth/register   body: { username, password, keyFile: '<base64>' }
app.post('/auth/register', async (req, res) => {
  const { username, password, keyFile } = req.body || {};

  if (!verifyKeyFile(keyFile))
    return res.status(403).json({ error: 'Invalid key file.' });

  if (!USERNAME_RE.test(username))
    return res.status(400).json({ error: 'Username must be 3–20 characters: letters, digits, _ or -' });

  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN)
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` });

  const key = username.toLowerCase();
  if (accounts.has(key))
    return res.status(409).json({ error: 'Username already taken.' });

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  accounts.set(key, { username, passwordHash });
  console.log(`Registered: ${username}`);

  const token = issueToken(username);
  res.json({ token, username });
});

// POST /auth/login   body: { username, password, keyFile: '<base64>' }
app.post('/auth/login', async (req, res) => {
  const { username, password, keyFile } = req.body || {};

  if (!verifyKeyFile(keyFile))
    return res.status(403).json({ error: 'Invalid key file.' });

  const key     = typeof username === 'string' ? username.toLowerCase() : '';
  const account = accounts.get(key);

  // Always run bcrypt even on missing account to prevent timing attacks
  const hashToCheck = account?.passwordHash ?? '$2b$12$invalidhashpaddingtomakethislong123456789012';
  const match = await bcrypt.compare(password ?? '', hashToCheck);

  if (!account || !match)
    return res.status(401).json({ error: 'Invalid username or password.' });

  console.log(`Login: ${account.username}`);
  const token = issueToken(account.username);
  res.json({ token, username: account.username });
});

// ── Socket.IO — token required in handshake ───────────────────────────────────
const io = new Server(server, {
  cors: { origin: false },
  pingTimeout:    6000,
  pingInterval:   4000,
  connectTimeout: 8000,
});

// Middleware: reject sockets that don't carry a valid JWT
io.use((socket, next) => {
  const token   = socket.handshake.auth?.token;
  const payload = verifyToken(token);
  if (!payload) return next(new Error('Unauthorised'));
  socket.username = payload.username;
  next();
});

io.on('connection', (socket) => {
  const { username } = socket;

  // Kick duplicate sessions for the same username
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
      socket.emit('error', 'You are sending messages too fast. Please slow down.');
      return;
    }
    const msg = sanitise(raw);
    if (!msg) {
      socket.emit('error', `Message must be between 1 and ${MAX_MSG_LENGTH} characters.`);
      return;
    }
    const entry = { user: userMap.get(socket.id) || 'Unknown', msg, ts: Date.now() };
    pushHistory(entry);
    io.emit('chat message', entry);
  });

  socket.on('disconnect', (reason) => {
    console.log(`${username} disconnected: ${reason}`);
    userMap.delete(socket.id);
    rateLimits.delete(socket.id);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
