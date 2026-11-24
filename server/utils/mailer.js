// Email sending, in this order of preference:
//  1. BREVO_API_KEY set: Brevo's web API (HTTPS, port 443). Use this on hosts that block email ports, e.g. Render's
//     free plan, where SMTP connections to Gmail time out. The sender (MAIL_FROM) must be a sender verified in Brevo.
//  2. SMTP_HOST set: your SMTP account (Gmail, Zoho…).
//  3. Neither (development): a free Ethereal test inbox, with a link to preview each email in the log.
const nodemailer = require('nodemailer');

const BREVO_SEND_ADDRESS = 'https://api.brevo.com/v3/smtp/email';
// never in automated tests: they must not send real emails, whatever is in the developer's .env
const brevoEnabled = () => Boolean(process.env.BREVO_API_KEY) && process.env.NODE_ENV !== 'test';

// Sends one email through Brevo's API. Throws on failure, like nodemailer, so the caller logs it and the job retries.
async function sendWithBrevo({ fromAddress, fromName, to, subject, html, text, replyTo }) {
  const response = await fetch(BREVO_SEND_ADDRESS, {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: fromName, email: fromAddress },
      to: [{ email: to }],
      subject,
      ...(html ? { htmlContent: html } : {}),
      ...(text ? { textContent: text } : {}),
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
    }),
    signal: AbortSignal.timeout(20000), // a stuck connection must not hold the email queue forever
  });
  const answer = await response.json().catch(() => ({}));
  // Brevo explains refusals in "message" (e.g. an unverified sender, or a wrong key): pass that on to the log
  if (!response.ok) throw new Error(`Brevo ${response.status}: ${answer.message || response.statusText}`);
  return { messageId: answer.messageId || '' };
}

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
async function sendMailNow({ to, subject, html, text, replyTo }) {
  if (!to) return { sent: false, reason: 'no recipient' };
  try {
    const sender = senderFor();
    if (brevoEnabled()) {
      // Brevo sends as the verified MAIL_FROM address itself, under the site's name ("Kapu <you@gmail.com>")
      const result = await sendWithBrevo({ fromAddress: emailOf(sender.from), fromName: nameOf(sender.from) || 'Kapu', to, subject, html, text, replyTo });
      console.log(`[email] "${subject}" -> ${to} (Brevo)`);
      return { sent: true, preview: null, messageId: result.messageId };
    }
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

const emailMode = () => (brevoEnabled() ? 'brevo' : process.env.SMTP_HOST ? 'smtp' : process.env.NODE_ENV === 'production' ? 'disabled' : 'ethereal');

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
