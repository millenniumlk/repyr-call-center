/**
 * WhatsApp Web Status Routes
 *
 * GET  /api/whatsapp/status  – Returns connection status (ready / qr_ready / etc.)
 * GET  /api/whatsapp/qr      – Returns the current QR code as a base64 PNG image
 *                              (so the agent dashboard can display it inline)
 */

const { Router } = require('express');
const QRCode = require('qrcode');
const { getStatus, getQrCode } = require('../services/whatsappService');

const router = Router();

/**
 * GET /api/whatsapp/status
 * Returns the current WhatsApp connection state.
 */
router.get('/status', (req, res) => {
  res.json(getStatus());
});

/**
 * GET /api/whatsapp/qr
 * Returns the QR code as a base64 PNG so the frontend can display it.
 * Returns 404 if no QR code is available (already connected, or mock mode).
 */
router.get('/qr', async (req, res) => {
  const qrString = getQrCode();

  if (!qrString) {
    return res.status(404).json({
      error: 'No QR code available. WhatsApp may already be connected.',
    });
  }

  try {
    // Convert QR string to a base64 PNG data URL
    const dataUrl = await QRCode.toDataURL(qrString, {
      width: 300,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    });

    res.json({ qr: dataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR image.' });
  }
});

module.exports = router;
