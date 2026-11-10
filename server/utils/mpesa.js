// Safaricom Daraja API helper: OAuth token, STK Push (Lipa Na M-Pesa Online) and STK Query
const axios = require('axios');

const baseURL = () =>
  process.env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  let data;
  try {
    ({ data } = await axios.get(`${baseURL()}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${auth}` },
    }));
  } catch (err) {
    const e = new Error('Could not authenticate with Daraja - check MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET and MPESA_ENV');
    e.response = { data: { errorMessage: e.message } };
    throw e;
  }
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (Number(data.expires_in || 3599) - 60) * 1000;
  return cachedToken;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function password(ts) {
  return Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${ts}`).toString('base64');
}

// Normalise 07xx / 01xx / +2547xx / 2547xx -> 2547xxxxxxxx
function formatPhone(phone) {
  let p = String(phone).replace(/\D/g, '');
  if (p.startsWith('0')) p = '254' + p.slice(1);
  else if (p.length === 9 && /^[17]/.test(p)) p = '254' + p;
  if (!/^254[17]\d{8}$/.test(p)) throw Object.assign(new Error('Invalid Safaricom phone number'), { status: 400 });
  return p;
}

async function stkPush({ phone, amount, accountReference, description }) {
  const token = await getAccessToken();
  const ts = timestamp();
  const msisdn = formatPhone(phone);
  const body = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password: password(ts),
    Timestamp: ts,
    TransactionType: process.env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline',
    Amount: Math.ceil(amount), // M-Pesa only accepts whole shillings
    PartyA: msisdn,
    PartyB: process.env.MPESA_SHORTCODE,
    PhoneNumber: msisdn,
    CallBackURL: process.env.MPESA_CALLBACK_URL,
    AccountReference: String(accountReference).slice(0, 12),
    TransactionDesc: String(description || 'POS Payment').slice(0, 13),
  };
  const { data } = await axios.post(`${baseURL()}/mpesa/stkpush/v1/processrequest`, body, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { ...data, phone: msisdn };
}

async function stkQuery(checkoutRequestId) {
  const token = await getAccessToken();
  const ts = timestamp();
  const { data } = await axios.post(
    `${baseURL()}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password(ts),
      Timestamp: ts,
      CheckoutRequestID: checkoutRequestId,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return data;
}

module.exports = { getAccessToken, stkPush, stkQuery, formatPhone };
