/**
 * Token utilities for call session security.
 *
 * We use cryptographically random bytes so tokens cannot be
 * guessed, brute-forced, or predicted from sequential IDs.
 */

const crypto = require('crypto');

/**
 * Generate a secure random call token.
 * 32 bytes = 256 bits of entropy, encoded as 64 hex characters.
 * @returns {string} e.g. "4baf3c1a0f9e2d..."
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a unique call ID using the built-in UUID v4 generator.
 * @returns {string} UUID v4
 */
function generateCallId() {
  return crypto.randomUUID();
}

module.exports = { generateToken, generateCallId };
