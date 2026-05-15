const crypto  = require('crypto');
const express = require('express');
const http    = require('http');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const helmet  = require('helmet');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');

const app    = express();
const server = http.createServer(app);

// ── Production Rate Limiting ──────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 requests per window
  message: { error: 'Too many attempts, please try again later.' }
});

// ── Security headers ───────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"], // Required for onclick handlers
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
if (!process.env.ACCESS_KEY) {
  console.error('FATAL: ACCESS_KEY environment variable not set.');
  process.exit(1);
}
const SERVER_KEY_BYTES = Buffer.from(process.env.ACCESS_KEY, 'utf8');

// ── JWT & Storage ─────────────────────────────────────────────────────────────
const JWT_SECRET = 'super-secret-key'; 
const users      = new Map(); // In production, replace with a Database
const history    = [];
const MAX_HIST   = 100;
const userMap    = new Map(); // socket.id -> username

function generateToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

// ── Auth Routes ───────────────────────────────────────────────────────────────
app.post('/auth/register', authLimiter, async (req, res) => {
  const { username, password, keyFile } = req.body;

  if (!username || !password || !keyFile) return res.status(400).json({ error: 'Missing fields' });
  if (users.has(username)) return res.status(400).json({ error: 'Username taken' });

  // Key File Verification
  const provided = Buffer.from(keyFile, 'base64');
  if (!crypto.timingSafeEqual(SERVER_KEY_BYTES, provided)) {
    return res.status(403).json({ error: 'Invalid Key File' });
  }

  const hash = await bcrypt.hash(password, 10);
  users.set(username, { hash });
  res.json({ token: generateToken(username), username });
});

app.post('/auth/login', authLimiter, async (req, res) => {
  const { username, password, keyFile } = req.body;
  const user = users.get(username);

  if (!user || !(await bcrypt.compare(password, user.hash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const provided = Buffer.from(keyFile, 'base64');
  if (!crypto.timingSafeEqual(SERVER_KEY_BYTES, provided)) {
    return res.status(403).json({ error: 'Invalid Key File' });
  }

  res.json({ token: generateToken(username), username });
});

// ── Socket.io ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
});

io.use((socket, next) => {
  const payload = verifyToken(socket.handshake.auth?.token);
  if (!payload) return next(new Error('Unauthorised'));
  socket.username = payload.username;
  next();
});

io.on('connection', (socket) => {
  const { username } = socket;

  // Single session enforcement
  for (const [id, name] of userMap) {
    if (name === username && id !== socket.id) {
      io.to(id).emit('kicked', 'Signed in from another location.');
      io.sockets.sockets.get(id)?.disconnect(true);
    }
  }

  userMap.set(socket.id, username);
  socket.emit('welcome', { username, history });

  socket.on('chat message', (raw) => {
    const msg = raw.toString().trim().substring(0, 500);
    if (!msg) return;

    const entry = { user: username, msg, ts: Date.now() };
    history.push(entry);
    if (history.length > MAX_HIST) history.shift();
    
    io.emit('chat message', entry);
  });

  socket.on('disconnect', () => userMap.delete(socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Production server on port ${PORT}`));