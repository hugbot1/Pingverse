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

const MONGO_URI = process.env.DATABASE_URL;
const ACCESS_KEY = process.env.ACCESS_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
const onlineUsers = new Set();

mongoose.connect(MONGO_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch(err => console.error("DB Error:", err));

const User = mongoose.model('User', new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  hash: { type: String, required: true }
}));

const Message = mongoose.model('Message', new mongoose.Schema({
  user: String,
  msg: String,
  ts: { type: Date, default: Date.now }
}));

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

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

app.post('/auth/register', authLimiter, async (req, res) => {
  const { username, password, keyFile } = req.body;
  try {
    const provided = Buffer.from(keyFile, 'base64');
    const SERVER_KEY_BYTES = Buffer.from(ACCESS_KEY || '', 'utf8');
    if (!crypto.timingSafeEqual(SERVER_KEY_BYTES, provided)) return res.status(403).json({ error: 'Invalid Key' });

    const hash = await bcrypt.hash(password, 10);
    await new User({ username, hash }).save();
    res.json({ token: jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' }), username });
  } catch (err) {
    res.status(400).json({ error: err.code === 11000 ? 'User exists' : 'Error' });
  }
});

app.post('/auth/login', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user || !(await bcrypt.compare(password, user.hash))) return res.status(401).json({ error: 'Invalid creds' });
  res.json({ token: jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' }), username });
});

const io = new Server(server);

io.use((socket, next) => {
  try {
    const payload = jwt.verify(socket.handshake.auth?.token, JWT_SECRET);
    socket.username = payload.username;
    next();
  } catch { next(new Error('Unauthorised')); }
});

io.on('connection', async (socket) => {
  const name = socket.username;
  onlineUsers.add(name);
  io.emit('status change');

  const history = await Message.find().sort({ ts: -1 }).limit(100);
  socket.emit('welcome', { username: name, history: history.reverse() });

  socket.on('chat message', async (raw) => {
    const msg = raw.toString().trim().substring(0, 500);
    if (!msg) return;
    const entry = await new Message({ user: name, msg }).save();
    io.emit('chat message', entry);
  });

  socket.on('get users', async () => {
    const all = await User.find({}, 'username');
    socket.emit('user list', all.map(u => ({ name: u.username, online: onlineUsers.has(u.username) })));
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(name);
    io.emit('status change');
  });
});

server.listen(process.env.PORT || 3000, () => console.log("Server Live"));