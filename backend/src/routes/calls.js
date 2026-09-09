/**
 * Call API Routes
 *
 * POST   /api/calls              – Create call, send WhatsApp invite
 * GET    /api/calls/token/:token – Validate customer token
 * GET    /api/calls/:callId/status – Get call status
 * POST   /api/calls/:callId/end  – End a call
 */

const { Router } = require('express');
const controller = require('../controllers/callController');
const { createCallLimiter, tokenValidationLimiter } = require('../middleware/rateLimiter');
const { validatePhone } = require('../middleware/validatePhone');

const router = Router();

// Create a new call session
router.post('/', createCallLimiter, validatePhone, controller.createCall);

// Validate a customer token (must come before /:callId routes)
router.get('/token/:token', tokenValidationLimiter, controller.validateToken);

// Get call status
router.get('/:callId/status', controller.getCallStatus);

// End a call
router.post('/:callId/end', controller.endCall);

module.exports = router;
