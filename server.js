const crypto = require('crypto');
const express = require('express');
const http = require('http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);

// ── Environment Variables ──────────────────────────────────────────────────
const MONGO_URI = process.env.DATABASE_URL;
const ACCESS_KEY = process.env.ACCESS_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'emergency-fallback-secret';

const onlineUsers = new Set();
let globalAnnouncement = { msg: '', important: false };

mongoose.connect(MONGO_URI).then(() => console.log("DB Connected"));

// ── Models ──────────────────────────────────────────────────────────────────
const User = mongoose.model('User', new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  hash: { type: String, required: true }
}));

const Message = mongoose.model('Message', new mongoose.Schema({
  user: String,
  msg: String,
  ts: { type: Date, default: Date.now }
}));

// ── Security ────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '16kb' }));
app.use(express.static('public'));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 25 });

// ── Helpers ─────────────────────────────────────────────────────────────────
async function verifyKeyRole(fileB64) {
  if (!fileB64) return null;
  const provided = Buffer.from(fileB64, 'base64').toString('utf8').trim();
  if (ADMIN_KEY && provided === ADMIN_KEY.trim()) return 'admin';
  if (ACCESS_KEY && provided === ACCESS_KEY.trim()) return 'user';
  return null;
}

// ── Auth Routes ─────────────────────────────────────────────────────────────
app.post('/auth/register', authLimiter, async (req, res) => {
  const { username, password, keyFile } = req.body;
  const role = await verifyKeyRole(keyFile);
  if (!role) return res.status(403).json({ error: 'Invalid Security Key' });

  try {
    const hash = await bcrypt.hash(password, 10);
    await new User({ username, hash }).save();
    res.json({ token: jwt.sign({ username, role }, JWT_SECRET), username, role });
  } catch (err) { res.status(400).json({ error: 'User exists' }); }
});

app.post('/auth/login', authLimiter, async (req, res) => {
  const { username, password, keyFile } = req.body;
  const role = await verifyKeyRole(keyFile);
  if (!role) return res.status(403).json({ error: 'Invalid Security Key' });

  const user = await User.findOne({ username });
  if (!user || !(await bcrypt.compare(password, user.hash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({ token: jwt.sign({ username, role }, JWT_SECRET), username, role });
});

// ── Sockets ─────────────────────────────────────────────────────────────────
const io = new Server(server);

io.use((socket, next) => {
  try {
    const payload = jwt.verify(socket.handshake.auth?.token, JWT_SECRET);
    socket.user = payload;
    next();
  } catch { next(new Error('Auth failed')); }
});

io.on('connection', async (socket) => {
  onlineUsers.add(socket.user.username);
  io.emit('status change');

  socket.emit('announcement', globalAnnouncement);
  const history = await Message.find().sort({ ts: -1 }).limit(100);
  socket.emit('welcome', { username: socket.user.username, role: socket.user.role, history: history.reverse() });

  socket.on('chat message', async (msg) => {
    const entry = await new Message({ user: socket.user.username, msg: msg.substring(0,500) }).save();
    io.emit('chat message', entry);
  });

  socket.on('set announcement', (data) => {
    if (socket.user.role !== 'admin') return;
    globalAnnouncement = { msg: data.msg, important: data.important };
    io.emit('announcement', globalAnnouncement);
  });

  socket.on('delete message', async (id) => {
    if (socket.user.role !== 'admin') return;
    await Message.findByIdAndDelete(id);
    io.emit('msg deleted', id);
  });

  socket.on('get users', async () => {
    const all = await User.find({}, 'username');
    socket.emit('user list', all.map(u => ({ name: u.username, online: onlineUsers.has(u.username) })));
  });

  socket.on('disconnect', () => { onlineUsers.delete(socket.user.username); io.emit('status change'); });
});

server.listen(process.env.PORT || 3000);