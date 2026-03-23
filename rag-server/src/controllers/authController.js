const {
  createSession,
  invalidateSession,
  requireSession,
  ADMIN_USER,
  ADMIN_PASS,
  timingSafeCompare
} = require('../middleware/auth');
const { logger } = require('../utils/logger');

// Brute-force login throttle — track failed attempts per IP
const loginAttempts = new Map(); // ip → { count, lockedUntil }
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function checkLoginThrottle(ip) {
  const entry = loginAttempts.get(ip) || { count: 0, lockedUntil: null };
  if (entry.lockedUntil && new Date() < entry.lockedUntil) {
    const remaining = Math.ceil((entry.lockedUntil - Date.now()) / 1000 / 60);
    return { locked: true, remaining };
  }
  return { locked: false, count: entry.count };
}

function recordFailedAttempt(ip) {
  const entry = loginAttempts.get(ip) || { count: 0, lockedUntil: null };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
    entry.count = 0;
    logger.warn(`Auth: IP ${ip} locked out for 15 minutes after ${MAX_ATTEMPTS} failed attempts`);
  }
  loginAttempts.set(ip, entry);
}

function clearAttempts(ip) {
  loginAttempts.delete(ip);
}

// ─── Controllers ────────────────────────────────────────

exports.login = (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  // Check lockout
  const throttle = checkLoginThrottle(ip);
  if (throttle.locked) {
    logger.warn(`Auth: locked IP ${ip} attempted login`);
    return res.status(429).json({
      error: 'Too many failed attempts.',
      message: `Account locked. Try again in ${throttle.remaining} minute(s).`
    });
  }

  // Validate credentials (timing-safe for both fields)
  const userOk = timingSafeCompare(username, ADMIN_USER);
  const passOk = timingSafeCompare(password, ADMIN_PASS);

  if (!userOk || !passOk) {
    recordFailedAttempt(ip);
    const remaining = MAX_ATTEMPTS - ((loginAttempts.get(ip) || {}).count || 0);
    logger.warn(`Auth: failed login for "${username}" from ${ip}`);
    return res.status(401).json({
      error: 'Invalid credentials.',
      attemptsRemaining: Math.max(0, remaining)
    });
  }

  clearAttempts(ip);
  const session = createSession(username);
  logger.info(`Auth: successful login for "${username}" from ${ip}`);

  res.json({
    message: 'Login successful.',
    token: session.token,
    expiresAt: session.expiresAt,
    username
  });
};

exports.logout = (req, res) => {
  const token = req.headers['x-session-token'];
  if (token) invalidateSession(token);
  res.json({ message: 'Logged out successfully.' });
};

exports.verify = [requireSession, (req, res) => {
  res.json({
    valid: true,
    username: req.session.username,
    expiresAt: req.session.expiresAt
  });
}];
