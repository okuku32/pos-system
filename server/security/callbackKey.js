// A secret part of the M-Pesa callback addresses. Safaricom gets the full address with every request we
// send (STK push, B2C), so only Safaricom knows it: anyone else posting a fake "paid" result is ignored.
// Set MPESA_CALLBACK_SECRET in server/.env, or one is derived from JWT_SECRET (stable across restarts).
const crypto = require('crypto');

function callbackKey() {
  const set = String(process.env.MPESA_CALLBACK_SECRET || '').trim();
  if (set.length >= 24) return set.replace(/[^A-Za-z0-9_-]/g, '');
  return crypto.createHmac('sha256', String(process.env.JWT_SECRET || 'dev')).update('mpesa-callback-v1').digest('base64url').slice(0, 40);
}

const sameKey = (given) => {
  const buffer = Buffer.from(String(given || ''));
  const currentBuffer = Buffer.from(callbackKey());
  return buffer.length === currentBuffer.length && crypto.timingSafeEqual(buffer, currentBuffer);
};

// Safaricom IDs: ws_CO_…, AG_…, plain letters/digits/dashes. Anything else (objects, operators) is refused.
const safaricomId = (value) => (typeof value === 'string' && /^[A-Za-z0-9_.-]{4,100}$/.test(value) ? value : null);

module.exports = { callbackKey, sameKey, safaricomId };
