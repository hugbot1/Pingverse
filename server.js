const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const helmet = require('helmet');

// ── Security: HTTP headers ────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'"],
        // 'self' covers same-origin ws:// and wss:// — the bare ws:/wss: entries
        // don't include the host, so the browser blocked the socket upgrade.
        connectSrc: ["'self'"],
      },
    },
  })
);

app.use(express.static('public'));

// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_MSG_LENGTH    = 500;
const RATE_LIMIT_WINDOW = 5000;  // ms
const RATE_LIMIT_MAX    = 10;
const MAX_HISTORY       = 100;

// ── In-memory state ───────────────────────────────────────────────────────────
let userCount = 1;
const userMap    = new Map();  // socket.id → username
const rateLimits = new Map();  // socket.id → { count, windowStart }
const history    = [];

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: false },
  // If the browser closes before the WS handshake finishes, the server
  // holds the socket open for pingTimeout + pingInterval ms by default
  // (~25 s total). Lowering these means stale sockets from rapid refreshes
  // are cleaned up in ~8 s instead of ~25 s, preventing the "hang" where
  // the new connection races against the old one's cleanup.
  pingTimeout:  6000,   // ms to wait for a pong before closing (default 20000)
  pingInterval: 4000,   // ms between pings                     (default  5000)
  // Cap how long the initial HTTP upgrade handshake can take.
  connectTimeout: 8000, // ms                                    (default 45000)
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function sanitise(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  if (!trimmed || trimmed.length > MAX_MSG_LENGTH) return null;
  return trimmed;
}

function checkRateLimit(socketId) {
  const now = Date.now();
  const record = rateLimits.get(socketId) || { count: 0, windowStart: now };
  if (now - record.windowStart > RATE_LIMIT_WINDOW) {
    record.count = 1;
    record.windowStart = now;
  } else {
    record.count += 1;
  }
  rateLimits.set(socketId, record);
  return record.count <= RATE_LIMIT_MAX;
}

function pushHistory(entry) {
  if (history.length >= MAX_HISTORY) history.shift();
  history.push(entry);
}

// ── Connection handler ────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  const username = 'User_' + String(userCount).padStart(3, '0');
  userCount++;
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
    const user  = userMap.get(socket.id) || 'Unknown';
    const entry = { user, msg, ts: Date.now() };
    pushHistory(entry);
    io.emit('chat message', entry);
  });

  socket.on('disconnect', (reason) => {
    const user = userMap.get(socket.id) || 'Unknown';
    console.log(`${user} disconnected: ${reason}`);
    userMap.delete(socket.id);
    rateLimits.delete(socket.id);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
