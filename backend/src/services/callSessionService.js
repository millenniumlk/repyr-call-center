/**
 * Call Session Service — In-Memory Store
 *
 * Manages the lifecycle of all active call sessions using a plain
 * JavaScript Map. This is intentionally simple for v1. The Map can
 * be replaced with Redis (using the same interface) later.
 *
 * Session shape:
 * {
 *   callId       : string   - UUID
 *   token        : string   - 64-char hex secret
 *   customerPhone: string   - E.164 e.g. "+971501234567"
 *   callUrl      : string   - full customer link
 *   status       : CallStatus
 *   agentSocketId  : string | null
 *   customerSocketId: string | null
 *   createdAt    : number   - Unix ms
 *   expiresAt    : number   - Unix ms (TTL)
 *   connectedAt  : number | null
 *   endedAt      : number | null
 * }
 *
 * CallStatus values:
 *   CREATED | INVITATION_SENT | WAITING | CUSTOMER_OPENED
 *   CUSTOMER_ANSWERING | CONNECTING | CONNECTED | ENDED | FAILED
 */

const { generateToken, generateCallId } = require('../utils/tokenUtils');

/** @type {Map<string, object>} callId to session */
const calls = new Map();

/** @type {Map<string, string>} token to callId */
const tokenIndex = new Map();

// Default token TTL while waiting for the customer to join (ms)
const INVITATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Extended TTL once the call is connected (ms)
const CONNECTED_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Create a new call session.
 * @param {string} customerPhone - E.164 phone number
 * @param {string} baseCallUrl   - e.g. "https://app.repyr.com"
 * @returns {object} The created session
 */
function createCall(customerPhone, baseCallUrl) {
  const callId = generateCallId();
  const token = generateToken();
  const callUrl = `${baseCallUrl}/c/${token}`;
  const now = Date.now();

  const session = {
    callId,
    token,
    customerPhone,
    callUrl,
    status: 'CREATED',
    agentSocketId: null,
    customerSocketId: null,
    createdAt: now,
    expiresAt: now + INVITATION_TTL_MS,
    connectedAt: null,
    endedAt: null,
  };

  calls.set(callId, session);
  tokenIndex.set(token, callId);

  // Auto-clean expired sessions
  setTimeout(() => _cleanupIfExpired(callId), INVITATION_TTL_MS + 1000);

  console.log(`[Session] Created call ${callId} for ${_maskPhone(customerPhone)}`);
  return session;
}

/**
 * Look up a session by its secret token.
 * Returns null if the token does not exist or is expired.
 * @param {string} token
 * @returns {object|null}
 */
function getCallByToken(token) {
  const callId = tokenIndex.get(token);
  if (!callId) return null;
  return _getIfValid(callId);
}

/**
 * Look up a session by call ID.
 * @param {string} callId
 * @returns {object|null}
 */
function getCallById(callId) {
  return _getIfValid(callId);
}

/**
 * Update the status of a call session.
 * @param {string} callId
 * @param {string} status
 * @param {object} [extra] - Additional fields to merge
 * @returns {object|null} Updated session or null
 */
function updateCallStatus(callId, status, extra = {}) {
  const session = calls.get(callId);
  if (!session) return null;

  session.status = status;
  Object.assign(session, extra);

  // When a call connects, extend the TTL
  if (status === 'CONNECTED') {
    session.connectedAt = Date.now();
    session.expiresAt = Date.now() + CONNECTED_TTL_MS;
  }

  console.log(`[Session] ${callId} -> ${status}`);
  return session;
}

/**
 * End a call: mark as ENDED, invalidate token.
 * @param {string} callId
 * @returns {object|null}
 */
function endCall(callId) {
  const session = calls.get(callId);
  if (!session) return null;

  session.status = 'ENDED';
  session.endedAt = Date.now();
  session.expiresAt = 0; // immediately invalid

  // Remove token from index so it cannot be reused
  tokenIndex.delete(session.token);

  console.log(`[Session] Ended call ${callId}`);

  // Schedule full cleanup after a short delay (so status can be polled)
  setTimeout(() => calls.delete(callId), 60 * 1000);

  return session;
}

/**
 * Get a masked version of a phone number for logging.
 * e.g. "+971501234567" -> "+971 50 XXX XXXX"
 */
function maskPhone(phone) {
  return _maskPhone(phone);
}

// --- Internal helpers ---

function _getIfValid(callId) {
  const session = calls.get(callId);
  if (!session) return null;
  if (session.status === 'ENDED') return session; // allow ENDED reads
  if (Date.now() > session.expiresAt) {
    _cleanupIfExpired(callId);
    return null;
  }
  return session;
}

function _cleanupIfExpired(callId) {
  const session = calls.get(callId);
  if (!session) return;
  if (Date.now() > session.expiresAt && session.status !== 'CONNECTED') {
    tokenIndex.delete(session.token);
    calls.delete(callId);
    console.log(`[Session] Expired and cleaned up: ${callId}`);
  }
}

function _maskPhone(phone) {
  if (!phone || phone.length < 6) return phone;
  const visible = phone.slice(0, 6);
  const masked = 'X'.repeat(Math.max(0, phone.length - 6));
  return `${visible}${masked}`;
}

module.exports = {
  createCall,
  getCallByToken,
  getCallById,
  updateCallStatus,
  endCall,
  maskPhone,
};
