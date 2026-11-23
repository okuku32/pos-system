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

function senderFor() {
  let name = 'Kapu';
  try {
    name = require('../config/site').site().name;
  } catch {
    /* settings not loaded yet */
  }
  const address = (process.env.MAIL_FROM || 'no-reply@kapu.co.ke').replace(/^.*<|>.*$/g, '').trim();
  return { from: `${name} <${address}>`, transport: null };
}

// Mail providers like Gmail only send "from" the account you log in with. When the configured sender is a
// different address, send from the login address but keep the shop's name, and let replies go to the
// configured address: customers see "Kapu <you@gmail.com>".
const emailOf = (text = '') => (String(text).match(/<([^>]+)>/)?.[1] || String(text)).trim().toLowerCase();
const nameOf = (text = '') => (String(text).match(/^\s*"?([^"<]+?)"?\s*</)?.[1] || '').trim();
function fromHeaders(sender) {
  const login = sender.transport ? '' : String(process.env.SMTP_USER || '').trim();
  if (!login.includes('@') || emailOf(sender.from) === login.toLowerCase()) return { from: sender.from };
  const name = nameOf(sender.from) || 'Kapu';
  const replyTo = emailOf(sender.from);
  return { from: `"${name.replace(/"/g, '')}" <${login}>`, ...(replyTo.includes('@') && !/no-?reply/.test(replyTo) ? { replyTo } : {}) };
}

// Never throws: an email problem must never break an order or a payment.
async function sendMailNow({ to, subject, html, text }) {
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

// queued: the request doesn't wait for the mail server, and a failed send is retried (utils/jobs.js)
function sendMail(message) {
  return require('./jobs').enqueue('email', { to: message.to, subject: message.subject, text: message.text, html: message.html, replyTo: message.replyTo })
    .then(() => ({ queued: true }))
    .catch((error) => {
      console.error('[email] could not queue, sending now:', error.message);
      return sendMailNow(message);
    });
}
// the background worker sends them (a failure throws, so the job is retried)
function startMailWorker() {
  require('./jobs').handle('email', async (message) => {
    const info = await sendMailNow(message);
    // retried only for a real failure (mail server down…), not when email is switched off
    if (!info.sent && !/^email |no recipient/.test(info.reason || '')) throw new Error(info.reason || 'not sent');
  });
}

module.exports = { emailMode, sendMail, sendMailNow, startMailWorker };
