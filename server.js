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

// ── CONFIG & STATE ──────────────────────────────────────────────────────────
const MONGO_URI = process.env.DATABASE_URL;
const ACCESS_KEY = process.env.ACCESS_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_only';

const onlineUsers = new Set();
let globalAnnouncement = { msg: '', important: false };

// ── DATABASE ────────────────────────────────────────────────────────────────
mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB Connected Successfully"))
  .catch(err => console.error("Database connection error:", err));

const User = mongoose.model('User', new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  hash: { type: String, required: true }
}));

const Message = mongoose.model('Message', new mongoose.Schema({
  user: String,
  msg: String,
  ts: { type: Date, default: Date.now }
}));

// ── MIDDLEWARE & SECURITY ───────────────────────────────────────────────────
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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 30,
  message: { error: 'Too many attempts, try later.' }
});

// ── AUTH LOGIC (MFA KEY VERIFICATION) ───────────────────────────────────────
async function verifyKeyRole(fileB64) {
  if (!fileB64) return null;
  try {
    const provided = Buffer.from(fileB64, 'base64').toString('utf8').trim();
    if (ADMIN_KEY && provided === ADMIN_KEY.trim()) return 'admin';
    if (ACCESS_KEY && provided === ACCESS_KEY.trim()) return 'user';
    return null;
  } catch (e) { return null; }
}

app.post('/auth/register', authLimiter, async (req, res) => {
  const { username, password, keyFile } = req.body;
  const role = await verifyKeyRole(keyFile);
  
  if (!role) return res.status(403).json({ error: 'Security Key verification failed.' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const newUser = new User({ username, hash });
    await newUser.save();
    
    const token = jwt.sign({ username, role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, username, role });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Username taken.' });
    res.status(500).json({ error: 'Registration error.' });
  }
});

app.post('/auth/login', authLimiter, async (req, res) => {
  const { username, password, keyFile } = req.body;
  const role = await verifyKeyRole(keyFile);
  
  if (!role) return res.status(403).json({ error: 'Security Key verification failed.' });

  const user = await User.findOne({ username });
  if (!user || !(await bcrypt.compare(password, user.hash))) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const token = jwt.sign({ username, role }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, username, role });
});

// ── SOCKET.IO (REAL-TIME LOGIC) ─────────────────────────────────────────────
const io = new Server(server);

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.userData = payload; 
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', async (socket) => {
  const { username, role } = socket.userData;
  onlineUsers.add(username);
  io.emit('status change');

  // Sync state
  socket.emit('announcement', globalAnnouncement);
  const history = await Message.find().sort({ ts: -1 }).limit(100);
  socket.emit('welcome', { username, role, history: history.reverse() });

  // Chat handling
  socket.on('chat message', async (msg) => {
    const cleanMsg = msg.toString().trim().substring(0, 500);
    if (!cleanMsg) return;
    const entry = new Message({ user: username, msg: cleanMsg });
    await entry.save();
    io.emit('chat message', entry);
  });

  // Admin Tools
  socket.on('set announcement', (data) => {
    if (role !== 'admin') return;
    globalAnnouncement = { msg: data.msg, important: data.important };
    io.emit('announcement', globalAnnouncement);
  });

  socket.on('delete message', async (msgId) => {
    if (role !== 'admin') return;
    await Message.findByIdAndDelete(msgId);
    io.emit('msg deleted', msgId);
  });

  socket.on('get users', async () => {
    const allUsers = await User.find({}, 'username');
    const list = allUsers.map(u => ({
      name: u.username,
      online: onlineUsers.has(u.username)
    }));
    socket.emit('user list', list);
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(username);
    io.emit('status change');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));