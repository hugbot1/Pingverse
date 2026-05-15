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
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", 'ws:', 'wss:'],
      },
    },
  })
);

app.use(express.static('public'));

// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_MSG_LENGTH    = 500;   // characters per message
const RATE_LIMIT_WINDOW = 5000;  // ms — sliding window
const RATE_LIMIT_MAX    = 10;    // messages allowed per window
const MAX_HISTORY       = 100;   // messages kept in memory

// ── In-memory state ───────────────────────────────────────────────────────────
let userCount = 1;
const userMap    = new Map();  // socket.id → username
const rateLimits = new Map();  // socket.id → { count, windowStart }
const history    = [];         // circular message store (capped at MAX_HISTORY)

// ── Socket.IO: CORS restricted to same origin ─────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: false,  // no cross-origin WebSocket connections
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Sanitise a raw message string:
 *  - Strip surrounding whitespace
 *  - Enforce max length
 *  - Remove control characters (except normal spaces / newlines)
 * Returns null if the result is empty or too long.
 */
function sanitise(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  if (!trimmed || trimmed.length > MAX_MSG_LENGTH) return null;
  return trimmed;
}

/**
 * Simple sliding-window rate limiter.
 * Returns true if the socket is within the allowed rate.
 */
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

/** Append a message to history, evicting the oldest if at capacity. */
function pushHistory(entry) {
  if (history.length >= MAX_HISTORY) history.shift();
  history.push(entry);
}

// ── Connection handler ────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  const username = 'User_' + String(userCount).padStart(3, '0');
  userCount++;
  userMap.set(socket.id, username);

  // Send the new user their username and the recent message history
  socket.emit('welcome', { username, history });
  console.log(`${username} connected`);

  socket.on('chat message', (raw) => {
    // 1. Rate limit
    if (!checkRateLimit(socket.id)) {
      socket.emit('error', 'You are sending messages too fast. Please slow down.');
      return;
    }

    // 2. Sanitise
    const msg = sanitise(raw);
    if (!msg) {
      socket.emit('error', `Message must be between 1 and ${MAX_MSG_LENGTH} characters.`);
      return;
    }

    // 3. Build and store the entry
    const user  = userMap.get(socket.id) || 'Unknown';
    const entry = { user, msg, ts: Date.now() };
    pushHistory(entry);

    // 4. Broadcast
    io.emit('chat message', entry);
  });

  socket.on('disconnect', () => {
    const user = userMap.get(socket.id) || 'Unknown';
    console.log(`${user} disconnected`);
    userMap.delete(socket.id);
    rateLimits.delete(socket.id);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
