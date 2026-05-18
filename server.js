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
  role: { type: String, default: 'user' },
  mutedUntil: { type: Date, default: null } 
}));

const Message = mongoose.model('Message', new mongoose.Schema({
  user: String,
  msg: String,
  role: String,
  to: { type: String, default: 'global' },
  replyTo: { type: Object, default: null },
  edited: { type: Boolean, default: false },
  ts: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }
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

  const rawHistory = await Message.find({
    $or: [{ to: 'global' }, { to: { $exists: false } }, { to: name }, { user: name }]
  }).sort({ ts: -1 }).limit(150);

  const history = rawHistory.map(doc => {
    const m = doc.toObject();
    return {
      ...m,
      to: m.to !== undefined ? m.to : 'global',
      replyTo: m.replyTo !== undefined ? m.replyTo : null,
      edited: m.edited !== undefined ? m.edited : false,
      read: m.read !== undefined ? m.read : false
    };
  });
  
  socket.emit('welcome', { username: name, role: role, history: history.reverse() });

  socket.on('chat message', async (data) => {
    const user = await User.findOne({ username: name });
    if (user.mutedUntil && user.mutedUntil > new Date()) {
      return socket.emit('error notice', `You are muted until ${user.mutedUntil.toLocaleTimeString()}`);
    }

    const msgContent = typeof data === 'string' ? data : data.msg;
    const cleanMsg = msgContent.trim().substring(0, 500);
    if (!cleanMsg) return;

    const entry = await new Message({ 
      user: name, 
      msg: cleanMsg, 
      role: role,
      to: data.to || 'global',
      replyTo: data.replyTo || null,
      edited: false,
      read: false
    }).save();

    if (entry.to === 'global') {
      io.emit('chat message', entry);
    } else {
      socket.emit('chat message', entry);
      const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.user.username === entry.to);
      if (targetSocket) {
        targetSocket.emit('chat message', entry);
        targetSocket.emit('user list update');
      }
      socket.emit('user list update');
    }
  });

  // Wipes all global chat logs for everyone if triggered by an admin
  socket.on('clear chat history', async () => {
    if (role !== 'admin') {
      return socket.emit('error notice', 'Access denied: Only system owners can perform a factory chat reset.');
    }
    try {
      await Message.deleteMany({ to: 'global' });
      io.emit('chat cleared');
    } catch (err) {
      socket.emit('error notice', 'Failed to purge database records.');
    }
  });

  socket.on('mark read', async (senderName) => {
    await Message.updateMany({ user: senderName, to: name, read: false }, { read: true });
    socket.emit('status change');
  });

  socket.on('edit message', async ({ id, newMsg }) => {
    const msg = await Message.findById(id);
    if (msg && msg.user === name) {
      msg.msg = newMsg.substring(0, 500);
      msg.edited = true;
      await msg.save();
      io.emit('msg updated', msg);
    }
  });

  socket.on('timeout user', async ({ target, mins }) => {
    if (role !== 'admin') return;
    const until = new Date(Date.now() + mins * 60000);
    await User.findOneAndUpdate({ username: target }, { mutedUntil: until });
    io.emit('user status alert', { target, muted: true, until });
  });

  socket.on('update account', async (data) => {
    const updates = {};
    if (data.username && data.username !== name) {
      const exists = await User.findOne({ username: data.username });
      if (exists) return socket.emit('settings error', 'Username taken');
      updates.username = data.username;
    }
    if (data.password) updates.hash = await bcrypt.hash(data.password, 10);
    
    await User.findOneAndUpdate({ username: name }, updates);
    if (updates.username) await Message.updateMany({ user: name }, { user: updates.username });
    socket.emit('settings success', 'Updated. Re-logging...');
  });

  socket.on('delete account', async (target) => {
    const targetUser = target || name;
    if (targetUser !== name && role !== 'admin') return;
    await Message.deleteMany({ user: targetUser });
    await User.deleteOne({ username: targetUser });
    if (targetUser === name) socket.emit('force logout');
    io.emit('status change');
  });

  socket.on('set announcement', async (data) => {
    if (role !== 'admin') return;
    await Announcement.deleteMany({});
    const newBC = new Announcement({ msg: data.msg, important: data.important });
    await newBC.save();
    io.emit('announcement', newBC);
  });

  socket.on('delete message', async (id) => {
    const msg = await Message.findById(id);
    if (role === 'admin' || (msg && msg.user === name)) {
      await Message.findByIdAndDelete(id);
      io.emit('msg deleted', id);
    }
  });

  socket.on('get users', async () => {
    const all = await User.find({}, 'username role mutedUntil');
    const unreadCounts = await Message.aggregate([
      { $match: { to: name, read: false } },
      { $group: { _id: '$user', count: { $sum: 1 } } }
    ]);
    const unreadMap = {};
    unreadCounts.forEach(item => { unreadMap[item._id] = item.count; });

    socket.emit('user list', all.map(u => ({ 
      name: u.username, 
      role: u.role, 
      online: onlineUsers.has(u.username),
      isMuted: u.mutedUntil && u.mutedUntil > new Date(),
      unreadCount: unreadMap[u.username] || 0
    })));
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(name);
    io.emit('status change');
  });
});

server.listen(process.env.PORT || 3000, () => console.log("Server Live"));