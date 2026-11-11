// Email sending. Uses your SMTP account when SMTP_HOST is set in .env.
// Without it (development), it uses a free Ethereal test inbox and logs a link to preview each email.
const nodemailer = require('nodemailer');

let transporterPromise = null;
let mode = 'none';

function getTransporter() {
  if (transporterPromise) return transporterPromise;
  transporterPromise = (async () => {
    if (process.env.SMTP_HOST) {
      mode = 'smtp';
      const port = Number(process.env.SMTP_PORT || 587);
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
        // App passwords are shown with spaces ("abcd efgh ijkl mnop"); the real password has none
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: String(process.env.SMTP_PASS || '').replace(/\s+/g, '') } : undefined,
      });
    }
    if (process.env.NODE_ENV === 'production') {
      mode = 'disabled';
      console.warn('[email] SMTP_HOST is not set: customer emails are disabled.');
      return null;
    }
    // Development fallback: throwaway Ethereal inbox (nothing is delivered to real people)
    const account = await nodemailer.createTestAccount();
    mode = 'ethereal';
    console.log(`[email] No SMTP configured: using Ethereal test inbox. Log in at https://ethereal.email with ${account.user} / ${account.pass}`);
    return nodemailer.createTransport({ host: account.smtp.host, port: account.smtp.port, secure: account.smtp.secure, auth: { user: account.user, pass: account.pass } });
  })().catch((err) => {
    console.error('[email] Could not set up email sending:', err.message);
    transporterPromise = null; // try again next time
    mode = 'error';
    return null;
  });
  return transporterPromise;
}

// A client can use their own SMTP account (Settings → Email); otherwise the platform's account is used.
const clientTransports = new Map();
function clientTransport(e) {
  if (!e?.smtpHost) return null;
  const key = `${e.smtpHost}:${e.smtpPort}:${e.smtpUser}`;
  if (!clientTransports.has(key)) {
    const port = Number(e.smtpPort || 587);
    clientTransports.set(key, nodemailer.createTransport({ host: e.smtpHost, port, secure: port === 465, auth: e.smtpUser ? { user: e.smtpUser, pass: e.smtpPass } : undefined }));
  }
  return clientTransports.get(key);
}

function senderFor() {
  try {
    const { settings, DEFAULT_SLUG } = require('../tenancy/tenants');
    const s = settings();
    // the original shop keeps using MAIL_FROM exactly as configured in .env
    if (s.slug === DEFAULT_SLUG() && process.env.MAIL_FROM && !s.email.smtpHost) return { from: process.env.MAIL_FROM, transport: null };
    return { from: s.email.from, transport: clientTransport(s.email) };
  } catch {
    return { from: process.env.MAIL_FROM || 'Ordersasa <no-reply@ordersasa.co.ke>', transport: null }; // no client context
  }
}

// Mail providers like Gmail only send "from" the account you log in with. When the configured sender is a
// different address, send from the login address but keep the shop's name, and let replies go to the
// configured address: customers see "Ordersasa <you@gmail.com>".
const emailOf = (s = '') => (String(s).match(/<([^>]+)>/)?.[1] || String(s)).trim().toLowerCase();
const nameOf = (s = '') => (String(s).match(/^\s*"?([^"<]+?)"?\s*</)?.[1] || '').trim();
function fromHeaders(sender) {
  const login = sender.transport ? '' : String(process.env.SMTP_USER || '').trim();
  if (!login.includes('@') || emailOf(sender.from) === login.toLowerCase()) return { from: sender.from };
  const name = nameOf(sender.from) || 'Ordersasa';
  const replyTo = emailOf(sender.from);
  return { from: `"${name.replace(/"/g, '')}" <${login}>`, ...(replyTo.includes('@') && !/no-?reply/.test(replyTo) ? { replyTo } : {}) };
}

// Never throws: an email problem must never break an order or a payment.
async function sendMail({ to, subject, html, text }) {
  if (!to) return { sent: false, reason: 'no recipient' };
  try {
    const sender = senderFor();
    const transporter = sender.transport || (await getTransporter());
    if (!transporter) return { sent: false, reason: `email ${mode}` };
    const info = await transporter.sendMail({
      ...fromHeaders(sender),
      to,
      subject,
      html,
      text,
    });
    const preview = nodemailer.getTestMessageUrl(info);
    console.log(`[email] "${subject}" -> ${to}${preview ? `  preview: ${preview}` : ''}`);
    return { sent: true, preview: preview || null, messageId: info.messageId };
  } catch (err) {
    console.error(`[email] Failed to send "${subject}" to ${to}:`, err.message);
    return { sent: false, reason: err.message };
  }
}

const emailMode = () => (process.env.SMTP_HOST ? 'smtp' : process.env.NODE_ENV === 'production' ? 'disabled' : 'ethereal');

module.exports = { sendMail, emailMode };
