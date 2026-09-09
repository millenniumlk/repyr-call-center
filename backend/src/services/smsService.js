const twilio = require('twilio');

// If credentials exist, initialize client; otherwise it will throw immediately on send
let twilioClient = null;
try {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
} catch (e) {
  console.warn('[Twilio] Failed to init client:', e.message);
}

/**
 * Send an SMS invitation to the customer.
 * 
 * @param {object} params
 * @param {string} params.phoneNumber - e.g. "+971501234567"
 * @param {string} params.callUrl - The unique call link
 */
async function sendCallInvitation({ phoneNumber, callUrl }) {
  const isMock = process.env.MOCK_SMS === 'true';

  console.log(`[SMS] Preparing to send to ${phoneNumber}`);
  console.log(`[SMS] Link: ${callUrl}`);

  if (isMock || !twilioClient) {
    console.log('[SMS] 🟡 Mock mode or Twilio not configured. Simulating success.');
    console.log('[SMS] Message would be:');
    console.log(`Hi! Your support agent is ready to speak with you. Click this secure link to join the audio call (no app required):\n${callUrl}`);
    return { success: true, mock: true };
  }

  try {
    const message = await twilioClient.messages.create({
      body: `Hi! Your support agent is ready to speak with you. Click this secure link to join the audio call (no app required):\n\n${callUrl}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber,
    });
    
    console.log(`[SMS] ✅ Sent successfully. SID: ${message.sid}`);
    return { success: true, sid: message.sid };
  } catch (error) {
    console.error(`[SMS] ❌ Send failed:`, error.message);
    throw error;
  }
}

module.exports = {
  sendCallInvitation,
};
