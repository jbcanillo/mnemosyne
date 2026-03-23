const rateLimit = require('express-rate-limit');

exports.createRateLimiter = (options = {}) => {
  return rateLimit({
    windowMs: options.windowMs || 60 * 1000,
    max: options.max || 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: options.message || { error: 'Rate limit exceeded', retryAfter: 60 },
    skip: (req) => req.path === '/health',
    keyGenerator: (req) =>
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip
  });
};
