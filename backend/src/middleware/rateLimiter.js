/**
 * Rate limiting middleware.
 * Applied to sensitive endpoints to prevent abuse.
 */

const rateLimit = require('express-rate-limit');

/**
 * Limit for creating new calls (POST /api/calls).
 * 10 calls per minute per IP.
 */
const createCallLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many call requests. Please wait before trying again.',
  },
});

/**
 * Limit for token validation (GET /api/calls/token/:token).
 * Prevents enumeration attacks. 30 requests per minute per IP.
 */
const tokenValidationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many validation requests.',
  },
});

module.exports = { createCallLimiter, tokenValidationLimiter };
