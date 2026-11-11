// Encrypts client secrets (M-Pesa keys, SMTP passwords, eTIMS keys) before they are stored in the database.
// AES-256-GCM with a key derived from SECRETS_KEY (falls back to JWT_SECRET). Keep SECRETS_KEY safe and stable:
// changing it makes stored secrets unreadable.
const crypto = require('crypto');

const key = () => crypto.createHash('sha256').update(String(process.env.SECRETS_KEY || process.env.JWT_SECRET || 'dev-only-key')).digest();

function encrypt(plain) {
  if (plain === undefined || plain === null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(value) {
  if (!value || typeof value !== 'string' || !value.startsWith('enc:v1:')) return value || '';
  try {
    const [, , iv, tag, data] = value.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return ''; // wrong key or corrupted
  }
}

// For showing in forms: never send the secret back, only whether one is saved
const mask = (value) => (value ? '••••••••' : '');

module.exports = { encrypt, decrypt, mask };
