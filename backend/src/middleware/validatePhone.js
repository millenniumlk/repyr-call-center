/**
 * Phone number validation middleware.
 * Validates E.164 format before processing a call creation request.
 */

/**
 * Basic E.164 validation.
 * Accepts: +[country code][number], 7–15 digits total.
 * @param {string} phone
 * @returns {boolean}
 */
function isValidE164(phone) {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

/**
 * Express middleware that validates `customerPhone` in req.body.
 */
function validatePhone(req, res, next) {
  const { customerPhone } = req.body;

  if (!customerPhone) {
    return res.status(400).json({ error: 'customerPhone is required.' });
  }

  const trimmed = customerPhone.trim();

  if (!isValidE164(trimmed)) {
    return res.status(400).json({
      error:
        'Invalid phone number. Use E.164 format (e.g. +971501234567).',
    });
  }

  // Normalize and pass forward
  req.body.customerPhone = trimmed;
  next();
}

module.exports = { validatePhone, isValidE164 };
