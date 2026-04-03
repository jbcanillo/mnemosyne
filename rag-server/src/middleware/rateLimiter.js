const rateLimit = require('express-rate-limit');

exports.createRateLimiter = (options = {}) => {
  return rateLimit({
    windowMs: options.windowMs || 60 * 1000,
    max: options.max || 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: options.message || { error: 'Rate limit exceeded', retryAfter: 60 },
    skip: (req) => req.path === '/health' || req.path?.includes('/info'),
    keyGenerator: (req) =>
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip
  });
};

// ── Login rate limiter: stricter to prevent brute force ──────────────
exports.loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  keyGenerator: (req) =>
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
  skip: (req) => req.method !== 'POST'
});

// ── Query/document operations: moderate limits ───────────────────────
// Allows burst requests but enforces reasonable throughput
exports.queryLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 150, // 150 requests per minute (2.5 per second average)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Query rate limit exceeded. Please try again in a moment.' },
  keyGenerator: (req) =>
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
  // Recovery: skip if more requests within window
  skip: (req) => {
    // Prioritize authenticated requests
    return !!(req.headers['x-session-token'] || req.headers['x-api-key']);
  }
});

// ── Status/health polling: lenient limits ────────────────────────────
// Status checks and polling should be exempt or very lenient
exports.statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300, // 300 requests per minute for status/health
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many status requests.' },
  keyGenerator: (req) =>
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
  skip: (req) => !!(req.headers['x-session-token'] || req.headers['x-api-key'])
});

// ── Upload operations: moderate limits ────────────────────────────────
exports.uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // 10 uploads per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Upload rate limit exceeded. Please wait before uploading more documents.' },
  keyGenerator: (req) =>
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
  skip: (req) => !!(req.headers['x-session-token'] || req.headers['x-api-key'])
});
