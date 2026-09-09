/**
 * Call Controller
 *
 * Business logic for call session HTTP endpoints.
 */

const callSessionService = require('../services/callSessionService');
const whatsappService = require('../services/whatsappService');

/**
 * POST /api/calls
 * Create a new call session and send the WhatsApp invitation.
 */
async function createCall(req, res) {
  try {
    const { customerPhone, baseCallUrl: clientUrl } = req.body;
    const baseCallUrl = clientUrl || process.env.BASE_CALL_URL || 'http://localhost:5173';

    // 1. Create in-memory session
    const session = callSessionService.createCall(customerPhone, baseCallUrl);

    // 2. Update status to sending
    callSessionService.updateCallStatus(session.callId, 'INVITATION_SENDING');

    // 3. Send WhatsApp (or mock)
    try {
      await whatsappService.sendCallInvitation({
        phoneNumber: customerPhone,
        callUrl: session.callUrl,
      });
      callSessionService.updateCallStatus(session.callId, 'INVITATION_SENT');
    } catch (waError) {
      console.error('[Controller] WhatsApp send failed:', waError.message);
      // Don't block the call — agent can still share URL manually
      callSessionService.updateCallStatus(session.callId, 'INVITATION_FAILED');
    }

    return res.status(201).json({
      callId: session.callId,
      callUrl: session.callUrl,
      status: session.status,
      mock: process.env.MOCK_WHATSAPP === 'true',
    });
  } catch (err) {
    console.error('[Controller] createCall error:', err);
    return res.status(500).json({ error: 'Failed to create call session.' });
  }
}

/**
 * GET /api/calls/token/:token
 * Validate a customer's call token and return safe call info.
 */
function validateToken(req, res) {
  const { token } = req.params;

  if (!token || token.length !== 64) {
    return res.status(400).json({ valid: false, error: 'Invalid token format.' });
  }

  const session = callSessionService.getCallByToken(token);

  if (!session) {
    return res.status(404).json({ valid: false, error: 'Call invitation not found or expired.' });
  }

  if (session.status === 'ENDED') {
    return res.status(410).json({ valid: false, error: 'This call has already ended.' });
  }

  // Return only safe, non-sensitive fields
  return res.json({
    valid: true,
    callId: session.callId,
    callerName: 'Repyr Support',
    customerPhoneMasked: callSessionService.maskPhone(session.customerPhone),
    status: session.status,
  });
}

/**
 * GET /api/calls/:callId/status
 * Return current status of a call (used by agent for polling fallback).
 */
function getCallStatus(req, res) {
  const { callId } = req.params;
  const session = callSessionService.getCallById(callId);

  if (!session) {
    return res.status(404).json({ error: 'Call not found.' });
  }

  return res.json({
    callId: session.callId,
    status: session.status,
    connectedAt: session.connectedAt,
    endedAt: session.endedAt,
  });
}

/**
 * POST /api/calls/:callId/end
 * Force-end a call session (can be called by agent or on cleanup).
 */
function endCall(req, res) {
  const { callId } = req.params;
  const session = callSessionService.endCall(callId);

  if (!session) {
    return res.status(404).json({ error: 'Call not found.' });
  }

  return res.json({ callId, status: 'ENDED' });
}

module.exports = { createCall, validateToken, getCallStatus, endCall };
