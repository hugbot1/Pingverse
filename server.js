const crypto  = require('crypto');
const express = require('express');
const http    = require('http');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const helmet  = require('helmet');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');

const app    = express();
const server = http.createServer(app);

// ── Database Connection ──────────────────────────────────────────────────────
const MONGO_URI = process.env.DATABASE_URL;
if (!MONGO_URI) {
  console.error("FATAL: DATABASE_URL environment variable not set.");
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(() => console.log("Connected to Cloud MongoDB"))
  .catch(err => console.error("Database connection error:", err));

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  hash: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

const msgSchema = new mongoose.Schema({
  user: String,
  msg: String,
  ts: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', msgSchema);

// ── Security & Middleware ─────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "https://cdn.socket.io"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
    },
  },
}));

app.use(express.json({ limit: '16kb' }));
app.use(express.static('public'));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 20, 
  message: { error: 'Too many attempts, please try again later.' }
});

const ACCESS_KEY = process.env.ACCESS_KEY;
const SERVER_KEY_BYTES = Buffer.from(ACCESS_KEY || '', 'utf8');
const JWT_SECRET = 'super-secret-key'; 

function generateToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
}

// ── Auth Routes ───────────────────────────────────────────────────────────────
app.post('/auth/register', authLimiter, async (req, res) => {
  const { username, password, keyFile } = req.body;
  
  try {
    const provided = Buffer.from(keyFile, 'base64');
    if (!crypto.timingSafeEqual(SERVER_KEY_BYTES, provided)) {
      return res.status(403).json({ error: 'Invalid Key File' });
    }

    const hash = await bcrypt.hash(password, 10);
    const newUser = new User({ username, hash });
    await newUser.save();
    res.json({ token: generateToken(username), username });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'User exists' });
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/auth/login', authLimiter, async (req, res) => {
  const { username, password, keyFile } = req.body;
  const user = await User.findOne({ username });
  if (!user || !(await bcrypt.compare(password, user.hash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({ token: generateToken(username), username });
});

// ── Socket.io ────────────────────────────────────────────────────────────────
const io = new Server(server);

io.use((socket, next) => {
  try {
    const payload = jwt.verify(socket.handshake.auth?.token, JWT_SECRET);
    socket.username = payload.username;
    next();
  } catch { next(new Error('Unauthorised')); }
});

io.on('connection', async (socket) => {
  // Load initial history
  const history = await Message.find().sort({ ts: -1 }).limit(100);
  socket.emit('welcome', { username: socket.username, history: history.reverse() });

  // Handle new messages
  socket.on('chat message', async (raw) => {
    const msg = raw.toString().trim().substring(0, 500);
    if (!msg) return;
    const entry = new Message({ user: socket.username, msg });
    await entry.save();
    io.emit('chat message', entry);
  });

  // Provide user list for search
  socket.on('get users', async () => {
    const allUsers = await User.find({}, 'username');
    socket.emit('user list', allUsers.map(u => u.username));
  });
});

server.listen(process.env.PORT || 3000, () => console.log("Server Live"));