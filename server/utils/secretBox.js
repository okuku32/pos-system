// Encrypts secrets we must keep but never show (a seller's own M-Pesa API keys): AES-256-GCM, a random IV per value,
// authenticated (a changed value fails to open). The key is PAY_SECRETS_KEY (64 hex chars) or, if unset, derived from
// JWT_SECRET with HKDF, so a database leak alone never reveals the keys.
const crypto = require('crypto');

function key() {
  const own = String(process.env.PAY_SECRETS_KEY || '').trim();
  if (/^[0-9a-f]{64}$/i.test(own)) return Buffer.from(own, 'hex');
  const base = process.env.JWT_SECRET;
  if (!base) throw new Error('PAY_SECRETS_KEY or JWT_SECRET must be set to store payment keys');
  return Buffer.from(crypto.hkdfSync('sha256', base, 'kapu', 'seller-mpesa-keys', 32));
}

// "v1.<iv>.<tag>.<data>" (base64url)
function seal(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

function open(sealed) {
  const [version, iv, tag, data] = String(sealed || '').split('.');
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unreadable secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

module.exports = { seal, open };
