// utils/webhooks.js
const axios = require("axios");

async function sendWebhook(event, data) {
  const WEBHOOK_URL = process.env.WEBHOOK_URL;
  if (!WEBHOOK_URL) return console.log("⚠️ No webhook URL configured");

  try {
    await axios.post(WEBHOOK_URL, {
      event,
      timestamp: new Date().toISOString(),
      data,
    });
    console.log(`✅ Webhook sent: ${event}`);
  } catch (err) {
    console.error("❌ Webhook failed:", err.message);
  }
}

module.exports = sendWebhook;
