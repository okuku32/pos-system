// Safaricom Daraja API helper: OAuth token, STK Push (Lipa Na M-Pesa Online) and STK Query.
// Keys, shortcode and passkey come from server/.env (see config/site.js).
const axios = require('axios');
const { site } = require('../config/site');

const baseURL = (cfg) =>
  ['production', 'live'].includes(cfg.env) ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';

const mpesaConfig = () => site().mpesa;

// Access tokens are cached until shortly before they expire
const tokens = new Map();

async function getAccessToken(cfg = mpesaConfig()) {
  if (!cfg.consumerKey || !cfg.consumerSecret) {
    const error = new Error('M-Pesa is not set up yet (MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET in server/.env)');
    error.response = { data: { errorMessage: error.message } };
    throw error;
  }
  const key = `${cfg.env}:${cfg.consumerKey}`;
  const hit = tokens.get(key);
  if (hit && Date.now() < hit.expiry) return hit.token;
  const auth = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString('base64');
  let data;
  try {
    ({ data } = await axios.get(`${baseURL(cfg)}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${auth}` },
    }));
  } catch {
    const error = new Error('Could not authenticate with Daraja - check the M-Pesa consumer key / secret and environment');
    error.response = { data: { errorMessage: error.message } };
    throw error;
  }
  tokens.set(key, { token: data.access_token, expiry: Date.now() + (Number(data.expires_in || 3599) - 60) * 1000 });
  return data.access_token;
}

function timestamp() {
  const date = new Date();
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

const password = (cfg, ts) => Buffer.from(`${cfg.shortcode}${cfg.passkey}${ts}`).toString('base64');

// Normalise 07xx / 01xx / +2547xx / 2547xx -> 2547xxxxxxxx
function formatPhone(phone) {
  let text = String(phone).replace(/\D/g, '');
  if (text.startsWith('0')) text = '254' + text.slice(1);
  else if (text.length === 9 && /^[17]/.test(text)) text = '254' + text;
  if (!/^254[17]\d{8}$/.test(text)) throw Object.assign(new Error('Invalid Safaricom phone number'), { status: 400 });
  return text;
}

// cfg: our own M-Pesa (default) or a seller's own Daraja app (split payments: the money goes straight to them).
// partyB: where the money goes (a Till under the seller's store number); default the shortcode itself (Paybill).
async function stkPush({ phone, amount, accountReference, description, cfg = mpesaConfig(), partyB, transactionType }) {
  if (!cfg.callbackUrl || /your-public-url/.test(cfg.callbackUrl)) {
    const error = new Error('M-Pesa callback address is not set (PUBLIC_API_URL in server/.env)');
    error.response = { data: { errorMessage: error.message } };
    throw error;
  }
  const token = await getAccessToken(cfg);
  const ts = timestamp();
  const msisdn = formatPhone(phone);
  const body = {
    BusinessShortCode: cfg.shortcode,
    Password: password(cfg, ts),
    Timestamp: ts,
    TransactionType: transactionType || cfg.transactionType || 'CustomerPayBillOnline',
    Amount: Math.ceil(amount), // M-Pesa only accepts whole shillings
    PartyA: msisdn,
    PartyB: partyB || cfg.shortcode,
    PhoneNumber: msisdn,
    CallBackURL: cfg.callbackUrl,
    AccountReference: String(accountReference).slice(0, 12),
    TransactionDesc: String(description || 'Order').slice(0, 13),
  };
  const { data } = await axios.post(`${baseURL(cfg)}/mpesa/stkpush/v1/processrequest`, body, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { ...data, phone: msisdn };
}

async function stkQuery(checkoutRequestId, cfg = mpesaConfig()) {
  const token = await getAccessToken(cfg);
  const ts = timestamp();
  const { data } = await axios.post(
    `${baseURL(cfg)}/mpesa/stkpushquery/v1/query`,
    { BusinessShortCode: cfg.shortcode, Password: password(cfg, ts), Timestamp: ts, CheckoutRequestID: checkoutRequestId },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return data;
}

// ---------------------------------------------------------------- B2C: paying riders & agents
// Needs a B2C shortcode from Safaricom, the initiator name and its encrypted security credential (server/.env).
function b2cReady(cfg = mpesaConfig()) {
  return !!(cfg.consumerKey && cfg.consumerSecret && cfg.b2cShortcode && cfg.initiatorName && cfg.securityCredential && cfg.b2cResultUrl);
}
async function b2cPay({ phone, amount, remarks, occasion }) {
  const cfg = mpesaConfig();
  if (!b2cReady(cfg)) {
    const error = new Error('M-Pesa B2C isn’t set up (MPESA_B2C_SHORTCODE, MPESA_INITIATOR_NAME, MPESA_SECURITY_CREDENTIAL in server/.env)');
    error.response = { data: { errorMessage: error.message } };
    throw error;
  }
  const token = await getAccessToken(cfg);
  const { data } = await axios.post(`${baseURL(cfg)}/mpesa/b2c/v1/paymentrequest`, {
    InitiatorName: cfg.initiatorName,
    SecurityCredential: cfg.securityCredential,
    CommandID: 'BusinessPayment',
    Amount: Math.round(amount),
    PartyA: cfg.b2cShortcode,
    PartyB: formatPhone(phone),
    Remarks: String(remarks || 'Kapu payout').slice(0, 100),
    QueueTimeOutURL: cfg.b2cTimeoutUrl || cfg.b2cResultUrl,
    ResultURL: cfg.b2cResultUrl,
    Occasion: String(occasion || '').slice(0, 100),
  }, { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 });
  if (data.ResponseCode !== '0' && data.ResponseCode !== 0) {
    const error = new Error(data.ResponseDescription || 'M-Pesa didn’t accept the transfer');
    error.response = { data: { errorMessage: error.message } };
    throw error;
  }
  return data; // { ConversationID, OriginatorConversationID, ResponseCode, ResponseDescription }
}

module.exports = { getAccessToken, stkPush, stkQuery, formatPhone, b2cReady, b2cPay };
