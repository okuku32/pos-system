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
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
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

// Never throws: an email problem must never break an order or a payment.
async function sendMail({ to, subject, html, text }) {
  if (!to) return { sent: false, reason: 'no recipient' };
  try {
    const transporter = await getTransporter();
    if (!transporter) return { sent: false, reason: `email ${mode}` };
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM || 'Ordersasa <no-reply@ordersasa.co.ke>',
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
