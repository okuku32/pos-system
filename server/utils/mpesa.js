// Safaricom Daraja API helper: OAuth token, STK Push (Lipa Na M-Pesa Online) and STK Query.
// Each client (tenant) uses their own Daraja keys, shortcode and passkey from their settings.
const axios = require('axios');
const { settings } = require('../tenancy/tenants');

const baseURL = (cfg) =>
  ['production', 'live'].includes(cfg.env) ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';

const mpesaConfig = () => settings().mpesa;

// Access tokens are cached per set of credentials (i.e. per client)
const tokens = new Map();

async function getAccessToken(cfg = mpesaConfig()) {
  if (!cfg.consumerKey || !cfg.consumerSecret) {
    const e = new Error('M-Pesa is not set up for this shop yet (Settings → M-Pesa)');
    e.response = { data: { errorMessage: e.message } };
    throw e;
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
    const e = new Error('Could not authenticate with Daraja - check the M-Pesa consumer key / secret and environment');
    e.response = { data: { errorMessage: e.message } };
    throw e;
  }
  tokens.set(key, { token: data.access_token, expiry: Date.now() + (Number(data.expires_in || 3599) - 60) * 1000 });
  return data.access_token;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const password = (cfg, ts) => Buffer.from(`${cfg.shortcode}${cfg.passkey}${ts}`).toString('base64');

// Normalise 07xx / 01xx / +2547xx / 2547xx -> 2547xxxxxxxx
function formatPhone(phone) {
  let p = String(phone).replace(/\D/g, '');
  if (p.startsWith('0')) p = '254' + p.slice(1);
  else if (p.length === 9 && /^[17]/.test(p)) p = '254' + p;
  if (!/^254[17]\d{8}$/.test(p)) throw Object.assign(new Error('Invalid Safaricom phone number'), { status: 400 });
  return p;
}

async function stkPush({ phone, amount, accountReference, description }) {
  const cfg = mpesaConfig();
  if (!cfg.callbackUrl || /your-public-url/.test(cfg.callbackUrl)) {
    const e = new Error('M-Pesa callback address is not set (PUBLIC_API_URL in server/.env)');
    e.response = { data: { errorMessage: e.message } };
    throw e;
  }
  const token = await getAccessToken(cfg);
  const ts = timestamp();
  const msisdn = formatPhone(phone);
  const body = {
    BusinessShortCode: cfg.shortcode,
    Password: password(cfg, ts),
    Timestamp: ts,
    TransactionType: cfg.transactionType || 'CustomerPayBillOnline',
    Amount: Math.ceil(amount), // M-Pesa only accepts whole shillings
    PartyA: msisdn,
    PartyB: cfg.shortcode,
    PhoneNumber: msisdn,
    CallBackURL: cfg.callbackUrl,
    AccountReference: String(accountReference).slice(0, 12),
    TransactionDesc: String(description || 'POS Payment').slice(0, 13),
  };
  const { data } = await axios.post(`${baseURL(cfg)}/mpesa/stkpush/v1/processrequest`, body, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { ...data, phone: msisdn };
}

async function stkQuery(checkoutRequestId) {
  const cfg = mpesaConfig();
  const token = await getAccessToken(cfg);
  const ts = timestamp();
  const { data } = await axios.post(
    `${baseURL(cfg)}/mpesa/stkpushquery/v1/query`,
    { BusinessShortCode: cfg.shortcode, Password: password(cfg, ts), Timestamp: ts, CheckoutRequestID: checkoutRequestId },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return data;
}

module.exports = { getAccessToken, stkPush, stkQuery, formatPhone };
