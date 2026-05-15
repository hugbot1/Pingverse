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
const EXPECTED_KEY = process.env.ACCESS_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
const onlineUsers = new Set();

mongoose.connect(MONGO_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch(err => console.error("DB Error:", err));

const User = mongoose.model('User', new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  hash: { type: String, required: true },
  role: { type: String, default: 'user' }
}));

const Message = mongoose.model('Message', new mongoose.Schema({
  user: String,
  msg: String,
  role: String, 
  ts: { type: Date, default: Date.now }
}));

const Announcement = mongoose.model('Announcement', new mongoose.Schema({
  msg: String,
  important: Boolean,
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

function getRoleFromKey(providedB64) {
  if (!providedB64) return null;
  const key = Buffer.from(providedB64, 'base64').toString('utf8').trim();
  if (ADMIN_KEY && key === ADMIN_KEY.trim()) return 'admin';
  if (EXPECTED_KEY && key === EXPECTED_KEY.trim()) return 'user';
  return null;
}

app.post('/auth/register', authLimiter, async (req, res) => {
  const { username, password, keyFile } = req.body;
  const role = getRoleFromKey(keyFile);
  if (!role) return res.status(403).json({ error: 'Invalid Key File' });

  try {
    const hash = await bcrypt.hash(password, 10);
    await new User({ username, hash, role }).save();
    res.json({ token: jwt.sign({ username, role }, JWT_SECRET, { expiresIn: '24h' }), username, role });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Username taken' });
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/auth/login', authLimiter, async (req, res) => {
  const { username, password, keyFile } = req.body;
  const role = getRoleFromKey(keyFile);
  if (!role) return res.status(403).json({ error: 'Invalid Key File' });

  const user = await User.findOne({ username });
  if (!user || !(await bcrypt.compare(password, user.hash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({ token: jwt.sign({ username, role }, JWT_SECRET, { expiresIn: '24h' }), username, role });
});

const io = new Server(server);

io.use((socket, next) => {
  try {
    const payload = jwt.verify(socket.handshake.auth?.token, JWT_SECRET);
    socket.user = payload;
    next();
  } catch { next(new Error('Unauthorised')); }
});

io.on('connection', async (socket) => {
  const name = socket.user.username;
  const role = socket.user.role;
  onlineUsers.add(name);
  io.emit('status change');

  const lastBC = await Announcement.findOne().sort({ ts: -1 });
  socket.emit('announcement', lastBC || { msg: '', important: false });

  const history = await Message.find().sort({ ts: -1 }).limit(100);
  socket.emit('welcome', { username: name, role: role, history: history.reverse() });

  socket.on('chat message', async (raw) => {
    const msg = raw.toString().trim().substring(0, 500);
    if (!msg) return;
    const entry = await new Message({ user: name, msg, role: role }).save();
    io.emit('chat message', entry);
  });

  socket.on('set announcement', async (data) => {
    if (socket.user.role !== 'admin') return;
    await Announcement.deleteMany({});
    const newBC = new Announcement({ msg: data.msg, important: data.important });
    await newBC.save();
    io.emit('announcement', newBC);
  });

  socket.on('delete message', async (id) => {
    if (socket.user.role !== 'admin') return;
    await Message.findByIdAndDelete(id);
    io.emit('msg deleted', id);
  });

  socket.on('get users', async () => {
    const all = await User.find({}, 'username role');
    socket.emit('user list', all.map(u => ({ 
      name: u.username, 
      role: u.role, 
      online: onlineUsers.has(u.username) 
    })));
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(name);
    io.emit('status change');
  });
});

server.listen(process.env.PORT || 3000, () => console.log("Server Live"));