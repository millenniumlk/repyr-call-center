const axios = require('axios');

/**
 * Send an SMS invitation to the customer via Notify.lk.
 * 
 * @param {object} params
 * @param {string} params.phoneNumber - e.g. "+9471XXXXXXX"
 * @param {string} params.callUrl - The unique call link
 */
async function sendCallInvitation({ phoneNumber, callUrl }) {
  const isMock = process.env.MOCK_SMS === 'true';

  // Format phone number for Notify.lk (e.g. remove + sign)
  // They expect format like "9471XXXXXXX"
  let formattedPhone = phoneNumber.replace(/[^0-9]/g, '');

  const messageBody = `Hi! Your support agent is ready. Click the link to join the audio call (no app required):\n\n${callUrl}`;

  console.log(`[SMS] Preparing to send to ${formattedPhone}`);
  console.log(`[SMS] Link: ${callUrl}`);

  const userId = process.env.NOTIFYLK_USER_ID;
  const apiKey = process.env.NOTIFYLK_API_KEY;
  const senderId = process.env.NOTIFYLK_SENDER_ID || 'NotifyDEMO';

  if (isMock || !userId || !apiKey) {
    console.log('[SMS] 🟡 Mock mode or Notify.lk not configured. Simulating success.');
    console.log('[SMS] Message would be:');
    console.log(messageBody);
    return { success: true, mock: true };
  }

  try {
    const response = await axios.post('https://app.notify.lk/api/v1/send', {
      user_id: userId,
      api_key: apiKey,
      sender_id: senderId,
      to: formattedPhone,
      message: messageBody,
    });
    
    if (response.data && response.data.status === 'success') {
      console.log(`[SMS] ✅ Sent successfully via Notify.lk.`);
      return { success: true, status: response.data.status };
    } else {
      console.error(`[SMS] ⚠️ Notify.lk Warning/Error:`, response.data);
      throw new Error('Notify.lk returned non-success status.');
    }
  } catch (error) {
    console.error(`[SMS] ❌ Send failed:`, error.message);
    throw error;
  }
}

module.exports = {
  sendCallInvitation,
};
