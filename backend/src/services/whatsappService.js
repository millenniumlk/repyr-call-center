/**
 * WhatsApp Web Service
 *
 * Uses whatsapp-web.js to send call invitations through a connected
 * personal WhatsApp account (no Meta Business API or template approval needed).
 *
 * HOW IT WORKS:
 *  1. On backend startup, a WhatsApp Web client is initialized.
 *  2. A QR code is printed to the terminal (and optionally served via API).
 *  3. Scan the QR code with your phone (WhatsApp → Linked Devices → Link a Device).
 *  4. Session is saved to .wwebjs_auth/ so you only scan once.
 *  5. sendCallInvitation() sends a plain-text message with the call link.
 *
 * IMPORTANT:
 *  - This uses a personal WhatsApp account, NOT a Business API account.
 *  - Messages are sent as plain text (no interactive buttons).
 *  - WhatsApp's terms of service prohibit bulk/automated messaging.
 *    This is intended for low-volume, legitimate customer support use.
 *
 * Environment variables:
 *  MOCK_WHATSAPP=true   → skips real send (for development)
 *  WA_SESSION_PATH      → path to save session data (default: ./.wwebjs_auth)
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// ─── State ─────────────────────────────────────────────────────────────────

/** @type {'initializing' | 'qr_ready' | 'authenticated' | 'ready' | 'disconnected' | 'auth_failure'} */
let waStatus = 'initializing';

/** The latest QR code string (for serving via API) */
let latestQrCode = null;

/** The whatsapp-web.js Client instance */
let waClient = null;

// ─── Initialize ─────────────────────────────────────────────────────────────

/**
 * Initialize the WhatsApp Web client.
 * Call this once at server startup.
 * The client will emit events and update waStatus.
 */
function initWhatsApp() {
  if (process.env.MOCK_WHATSAPP === 'true') {
    waStatus = 'ready';
    console.log('[WhatsApp] Mock mode enabled — skipping WhatsApp Web init.');
    return;
  }

  console.log('[WhatsApp] Initializing WhatsApp Web client…');

  // Locate system Chrome — avoids needing Puppeteer's bundled Chromium download
  const { existsSync } = require('fs');
  const chromePaths = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
      : null,
    // Edge as fallback on Windows
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    // Linux / macOS
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);

  const executablePath = chromePaths.find((p) => existsSync(p));

  if (!executablePath) {
    console.error('[WhatsApp] ✗ Could not find Chrome/Edge. Set CHROME_PATH in .env or install Google Chrome.');
    waStatus = 'disconnected';
    return;
  }

  console.log(`[WhatsApp] Using browser: ${executablePath}`);

  waClient = new Client({
    authStrategy: new LocalAuth({
      dataPath: process.env.WA_SESSION_PATH || './.wwebjs_auth',
    }),
    puppeteer: {
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    },
  });

  // ── QR Code ────────────────────────────────────────────────────────────
  waClient.on('qr', (qr) => {
    waStatus = 'qr_ready';
    latestQrCode = qr;

    console.log('\n[WhatsApp] Scan this QR code with your phone:');
    console.log('           WhatsApp → Linked Devices → Link a Device\n');
    // Print QR to terminal
    qrcode.generate(qr, { small: true });
    console.log('\n[WhatsApp] Waiting for scan…\n');
  });

  // ── Authenticated ───────────────────────────────────────────────────────
  waClient.on('authenticated', () => {
    waStatus = 'authenticated';
    latestQrCode = null;
    console.log('[WhatsApp] ✓ Authenticated — session saved.');
  });

  // ── Ready ───────────────────────────────────────────────────────────────
  waClient.on('ready', () => {
    waStatus = 'ready';
    const info = waClient.info;
    console.log(`[WhatsApp] ✓ Connected as: ${info?.pushname} (${info?.wid?.user})`);
  });

  // ── Auth failure ────────────────────────────────────────────────────────
  waClient.on('auth_failure', (msg) => {
    waStatus = 'auth_failure';
    console.error('[WhatsApp] ✗ Auth failure:', msg);
  });

  // ── Disconnected ────────────────────────────────────────────────────────
  waClient.on('disconnected', (reason) => {
    waStatus = 'disconnected';
    console.warn('[WhatsApp] Disconnected:', reason);
  });

  // Start the client
  waClient.initialize().catch((err) => {
    waStatus = 'disconnected';
    console.error('[WhatsApp] Failed to initialize:', err.message);
  });
}

// ─── Send message ───────────────────────────────────────────────────────────

/**
 * Send a call invitation via WhatsApp.
 *
 * @param {object} params
 * @param {string} params.phoneNumber - E.164 format e.g. "+971501234567"
 * @param {string} params.callUrl     - e.g. "http://localhost:5173/c/abc123"
 * @returns {Promise<{ success: boolean, mock?: boolean, messageId?: string }>}
 */
async function sendCallInvitation({ phoneNumber, callUrl }) {
  // ── Mock mode ─────────────────────────────────────────────────────────
  if (process.env.MOCK_WHATSAPP === 'true') {
    console.log('\n[WhatsApp MOCK] Skipping real send.');
    console.log(`  → To:  ${phoneNumber}`);
    console.log(`  → URL: ${callUrl}\n`);
    return { success: true, mock: true };
  }

  // ── Check readiness ───────────────────────────────────────────────────
  if (waStatus !== 'ready') {
    throw new Error(
      `WhatsApp client is not ready (status: ${waStatus}). ` +
      (waStatus === 'qr_ready'
        ? 'Please scan the QR code in the terminal.'
        : 'Please wait for the client to initialize.')
    );
  }

  // ── Format phone number for WhatsApp ─────────────────────────────────
  // WhatsApp expects: <countrycode><number>@c.us (no + sign)
  const digits = phoneNumber.replace(/\D/g, '');
  const chatId = `${digits}@c.us`;

  // ── Compose message ───────────────────────────────────────────────────
  const message = [
    '🔧 *Repyr Vehicle Diagnostics*',
    '',
    'An agent is ready to speak with you.',
    '',
    '📞 *Tap the link below to answer the call:*',
    callUrl,
    '',
    '_This is a secure, browser-based audio call._',
    '_No app download required._',
  ].join('\n');

  try {
    const result = await waClient.sendMessage(chatId, message);
    const msgId = result?.id?._serialized || 'unknown';
    console.log(`[WhatsApp] ✓ Message sent to ${phoneNumber}, ID: ${msgId}`);
    return { success: true, messageId: msgId };
  } catch (err) {
    console.error('[WhatsApp] ✗ Failed to send:', err.message);
    throw new Error(`WhatsApp send failed: ${err.message}`);
  }
}

// ─── Status & QR getters ─────────────────────────────────────────────────────

/** Get current WhatsApp connection status */
function getStatus() {
  return {
    status: waStatus,
    hasQr: latestQrCode !== null,
    mock: process.env.MOCK_WHATSAPP === 'true',
  };
}

/** Get the latest QR code string (for rendering via API) */
function getQrCode() {
  return latestQrCode;
}

module.exports = {
  initWhatsApp,
  sendCallInvitation,
  getStatus,
  getQrCode,
};
