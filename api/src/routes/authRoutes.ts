import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { UserModel } from '../models/userModel.js';
import { signSession } from '../utils/jwt.js';
import { buildSessionCookie, buildClearedSessionCookie } from '../utils/cookies.js';
import { registerSchema, loginSchema, safeParse } from '../utils/validation.js';
import { authLimiter, meLimiter } from '../middleware/rateLimit.js';
import { requireTrustedOrigin } from '../middleware/security.js';
import { requireAuth } from '../middleware/auth.js';
import { errorMessage } from '../utils/errors.js';

const BCRYPT_COST = 12;

// Cap on accounts waiting for approval, so a bot can't bury the admin queue.
const MAX_PENDING_ACCOUNTS = 100;

// A real bcrypt hash (same cost as real ones) computed once at startup. Login
// compares against it when the username doesn't exist, so response time
// doesn't reveal whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('pingverse-dummy-password', BCRYPT_COST);

export const authRouter = Router();

authRouter.post('/register', authLimiter, requireTrustedOrigin, async (req, res) => {
  const parsed = safeParse(registerSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const { username, password } = parsed.data;

  if (UserModel.exists(username)) {
    return res.status(400).json({ error: 'Username taken' });
  }

  if (UserModel.countPending() >= MAX_PENDING_ACCOUNTS) {
    return res.status(503).json({ error: 'Registration is temporarily closed. Please try again later.' });
  }

  try {
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    UserModel.createPending({ username, hash });
  } catch (err) {
    if (String(errorMessage(err)).includes('UNIQUE')) {
      return res.status(400).json({ error: 'Username taken' });
    }
    console.error('Registration failed:', err);
    return res.status(500).json({ error: 'Registration failed' });
  }

  // No session is issued: the account cannot be used until an admin approves it.
  res.status(201).json({
    status: 'pending',
    message: 'Account created. An administrator must approve it before you can sign in.',
  });
});

authRouter.post('/login', authLimiter, requireTrustedOrigin, async (req, res) => {
  const parsed = safeParse(loginSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const { username, password } = parsed.data;

  const user = UserModel.findByUsername(username);
  const passwordOk = await bcrypt.compare(password, user ? user.hash : DUMMY_HASH);

  if (!user || !passwordOk) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Only revealed after the password was correct.
  if (user.status !== 'approved') {
    return res.status(403).json({
      error: 'Your account is awaiting approval by an administrator.',
      code: 'pending',
    });
  }

  res.setHeader('Set-Cookie', buildSessionCookie(signSession(user.username)));
  res.json({ username: user.username, role: user.role });
});

authRouter.post('/logout', requireTrustedOrigin, (_req, res) => {
  res.setHeader('Set-Cookie', buildClearedSessionCookie());
  res.json({ ok: true });
});

authRouter.get('/me', meLimiter, requireAuth, (req, res) => {
  res.json({ username: req.user!.username, role: req.user!.role });
});
