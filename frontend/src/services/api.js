/**
 * REST API client for the Repyr Call Center backend.
 */

import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    'Bypass-Tunnel-Reminder': 'true',
    'ngrok-skip-browser-warning': 'true',
  },
});

/**
 * Create a new call session.
 * @param {string} customerPhone - E.164 format
 * @param {string} baseCallUrl - The frontend URL (for WhatsApp link)
 * @returns {Promise<{callId, callUrl, status, mock}>}
 */
export async function createCall(customerPhone, baseCallUrl) {
  const { data } = await api.post('/calls', { customerPhone, baseCallUrl });
  return data;
}

/**
 * Validate a customer call token.
 * @param {string} token
 * @returns {Promise<{valid, callId, callerName, customerPhoneMasked, status}>}
 */
export async function validateToken(token) {
  const { data } = await api.get(`/calls/token/${token}`);
  return data;
}

/**
 * Get call status by call ID.
 * @param {string} callId
 * @returns {Promise<{callId, status, connectedAt, endedAt}>}
 */
export async function getCallStatus(callId) {
  const { data } = await api.get(`/calls/${callId}/status`);
  return data;
}

/**
 * Force-end a call.
 * @param {string} callId
 * @returns {Promise<{callId, status}>}
 */
export async function endCall(callId) {
  const { data } = await api.post(`/calls/${callId}/end`);
  return data;
}

/**
 * Get WhatsApp Web connection status.
 * @returns {Promise<{status, hasQr, mock}>}
 */
export async function getWhatsAppStatus() {
  const { data } = await api.get('/whatsapp/status');
  return data;
}

/**
 * Get WhatsApp QR code as a base64 PNG data URL.
 * @returns {Promise<{qr: string}>}
 */
export async function getWhatsAppQr() {
  const { data } = await api.get('/whatsapp/qr');
  return data;
}

export default api;
