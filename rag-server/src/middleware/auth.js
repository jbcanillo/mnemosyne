const crypto = require('crypto');
const { logger } = require('../utils/logger');
const apiKeyService = require('../services/apiKeyService');

/**
 * API Key Authentication Middleware
 *
 * Accepts the key in any of these formats (in priority order):
 *   1. Header:  X-API-Key: <key>
 *   2. Header:  Authorization: Bearer <key>
 *   3. Query:   ?api_key=<key>   (only for GET /health — disabled on mutation routes)
 *
 * Key is validated against the configured API keys in Redis.
 */

// Initialize API key service
let apiKeyServiceReady = false;
apiKeyService.initialize().then(() => {
  apiKeyServiceReady = true;
  logger.info('[Auth] API key service initialized');
}).catch(err => {
  logger.error('[Auth] Failed to initialize API key service:', err.message);
  process.exit(1);
});

// For backward compatibility, allow the single RAG_API_KEY if no keys are configured
const VALID_KEY = process.env.RAG_API_KEY;
const useLegacyKey = VALID_KEY && VALID_KEY.length >= 32;

function extractKey(req) {
  // 1. X-API-Key header (preferred)
  if (req.headers['x-api-key']) return req.headers['x-api-key'];

  // 2. Authorization: Bearer <key>
  const auth = req.headers['authorization'];
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }

  // 3. Query param (only allow on safe GET routes, checked below)
  if (req.method === 'GET' && req.query.api_key) {
    return req.query.api_key;
  }

  return null;
}

function timingSafeCompare(a, b) {
  try {
    // Both must be same byte length for timingSafeEqual
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      // Still do a dummy compare to avoid timing leak on length
      crypto.timingSafeEqual(bufA, bufA);
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * requireApiKey — attach to any route that needs protection
 */
function requireApiKey(req, res, next) {
  if (!apiKeyServiceReady) {
    logger.error(`Auth: API key service not ready — ${req.method} ${req.path} from ${req.ip}`);
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'Authentication service is initializing. Please try again.'
    });
  }

  const provided = extractKey(req);
  logger.info(`[Auth] requireApiKey: extracted key=${provided ? 'yes' : 'no'} from ${req.method} ${req.path}`);

  if (!provided) {
    logger.warn(`Auth: missing key — ${req.method} ${req.path} from ${req.ip}`);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API key required. Provide it via X-API-Key header or Authorization: Bearer <key>.'
    });
  }

  // Try to validate against configured API keys first
  const validKey = apiKeyService.validateKey(provided);
  if (validKey) {
    // Key is valid from configured keys
    req.authenticated = true;
    req.apiKey = validKey;
    return next();
  }

  // Fall back to legacy single RAG_API_KEY from environment
  if (useLegacyKey && timingSafeCompare(provided, VALID_KEY)) {
    req.authenticated = true;
    req.apiKey = { name: 'Default API Key', id: 'default', key: VALID_KEY };
    return next();
  }

  // Key is invalid
  logger.warn(`Auth: invalid key — ${req.method} ${req.path} from ${req.ip}`);
  return res.status(403).json({
    error: 'Forbidden',
    message: 'Invalid API key.'
  });
}

/**
 * UI Session Auth
 *
 * The React UI uses a simple session token approach:
 *   POST /api/auth/login  { username, password }  → { token, expiresAt }
 *   All other UI requests send:  X-Session-Token: <token>
 *
 * Sessions are stored in-memory (Map). They expire after SESSION_TTL_HOURS.
 * On server restart, all sessions are invalidated (users must log in again).
 */

const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASS || ADMIN_PASS.length < 8) {
  logger.error('FATAL: ADMIN_PASSWORD is not set or is shorter than 8 characters. Refusing to start.');
  process.exit(1);
}

const SESSION_TTL_MS = (parseInt(process.env.SESSION_TTL_HOURS || '8')) * 60 * 60 * 1000;
const activeSessions = new Map(); // token → { username, expiresAt }

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(username) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  activeSessions.set(token, { username, expiresAt });
  // Sweep expired sessions on every create to keep memory clean
  for (const [t, s] of activeSessions) {
    if (new Date() > s.expiresAt) activeSessions.delete(t);
  }
  return { token, expiresAt };
}

function requireSession(req, res, next) {
  const token = req.headers['x-session-token'];

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Session token required.' });
  }

  const session = activeSessions.get(token);

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired session. Please log in again.' });
  }

  if (new Date() > session.expiresAt) {
    activeSessions.delete(token);
    return res.status(401).json({ error: 'Unauthorized', message: 'Session expired. Please log in again.' });
  }

  req.session = session;
  next();
}

/**
 * eitherAuth - Accepts EITHER API key OR session token
 * Use this on routes that should be accessible by both server-to-server (API key)
 * and browser/UI (session token) clients.
 */
function eitherAuth(req, res, next) {
  // Check if API key is provided
  const hasApiKey = req.headers['x-api-key'] || req.headers['authorization'];

  if (hasApiKey) {
    // Try API key authentication
    return requireApiKey(req, res, next);
  }

  // Otherwise try session token
  return requireSession(req, res, next);
}

function invalidateSession(token) {
  activeSessions.delete(token);
}

module.exports = {
  requireApiKey,
  requireSession,
  eitherAuth,
  createSession,
  invalidateSession,
  ADMIN_USER,
  ADMIN_PASS,
  timingSafeCompare
};
