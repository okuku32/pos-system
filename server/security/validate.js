// Request validation: a small schema checker for request bodies.
//   router.post('/login', validate({ login: v.string({ min: 3, max: 120 }), password: v.string({ max: 200 }) }), handler)
// Unknown fields are dropped (no mass assignment), wrong types are refused with a clear 400 message.
const httpError = require('../utils/httpError');

const fail = (label, msg) => {
  throw httpError(msg || `Please check ${label}`);
};

// one spelling per address: Unicode-normalised (NFKC), no spaces, lowercase
const normalizeEmail = (raw) => String(raw ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
// sensible shape: local@domain.tld, 254 characters max (64 before the @), no double dots, no dot at either end
function validEmail(email) {
  if (typeof email !== 'string' || email.length > 254) return false;
  const match = /^([^\s@<>()[\],;:"]+)@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,})$/i.exec(email);
  if (!match) return false;
  const [, local] = match;
  return local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..');
}

const value = {
  string: ({ min = 0, max = 500, pattern, label, optional = false, trim = true, message } = {}) => (val, name) => {
    if (val === undefined || val === null || val === '') {
      if (optional) return undefined;
      if (min > 0) fail(label || name, message || `Please enter ${label || name}`);
      return '';
    }
    if (typeof val !== 'string' && typeof val !== 'number') fail(label || name, message);
    let currentVal = String(val);
    if (trim) currentVal = currentVal.trim();
    if (currentVal.length < min || currentVal.length > max) fail(label || name, message || `${label || name} must be ${min}–${max} characters`);
    if (pattern && !pattern.test(currentVal)) fail(label || name, message);
    return currentVal;
  },
  email: (opts = {}) => (val, name) => {
    const text = value.string({ max: 254, label: 'your email', ...opts })(val, name);
    if (!text) return text;
    const email = normalizeEmail(text);
    if (!validEmail(email)) fail('', 'Please enter a valid email address');
    return email;
  },
  int: ({ min = -Infinity, max = Infinity, optional = false, label, message } = {}) => (val, name) => {
    if (val === undefined || val === null || val === '') return optional ? undefined : fail(label || name, message);
    const currentVal = Number(val);
    if (!Number.isFinite(currentVal) || Math.round(currentVal) !== currentVal || currentVal < min || currentVal > max) fail(label || name, message || `${label || name} must be a whole number from ${min} to ${max}`);
    return currentVal;
  },
  bool: ({ optional = true } = {}) => (val, name) => {
    if (val === undefined) return optional ? undefined : fail(name);
    if (typeof val === 'boolean') return val;
    if (val === 'true' || val === 'false') return val === 'true';
    return fail(name);
  },
  oneOf: (list, { optional = false, label } = {}) => (val, name) => {
    if (val === undefined || val === null || val === '') return optional ? undefined : fail(label || name);
    if (!list.includes(val)) fail(label || name);
    return val;
  },
  id: ({ optional = false } = {}) => (val, name) => {
    if (val === undefined || val === null || val === '') return optional ? undefined : fail(name);
    if (typeof val !== 'string' || !/^[a-f0-9]{24}$/i.test(val)) fail(name);
    return val;
  },
  any: () => (val) => val, // validated further inside the handler
};

// a password someone chooses: 8–200 characters with letters and numbers, not an obvious one
const COMMON = /^(password|passw0rd|12345678|123456789|qwerty|letmein|welcome|kapu|admin|iloveyou)\d*$/i;
// Strong passwords (new accounts, password changes and resets; existing passwords keep working):
// 10+ characters with an uppercase letter, a lowercase letter and a number; not a common password; not the
// person's name or email. { name, email } are optional, for that last check.
const PASSWORD_RULES = 'Use at least 10 characters, with an uppercase letter, a lowercase letter and a number';
value.newPassword = (who = {}) => (val) => {
  if (typeof val !== 'string' || !val) fail('', 'Please choose a password');
  if (val.length < 10 || val.length > 200 || !/[a-z]/.test(val) || !/[A-Z]/.test(val) || !/\d/.test(val)) fail('', PASSWORD_RULES);
  if (COMMON.test(val) || /^(.)\1+$/.test(val)) fail('', 'That password is too easy to guess. Choose another one.');
  const lower = val.toLowerCase();
  const parts = [String(who.email || '').split('@')[0], ...String(who.name || '').split(/\s+/)].map((part) => part.toLowerCase()).filter((part) => part.length >= 4);
  if (parts.some((part) => lower.includes(part))) fail('', 'Don’t use your name or email in your password');
  return val;
};
value.PASSWORD_RULES = PASSWORD_RULES;

function validate(schema, where = 'body') {
  return (req, res, next) => {
    try {
      const src = req[where] && typeof req[where] === 'object' ? req[where] : {};
      const out = {};
      for (const [key, check] of Object.entries(schema)) {
        const val = check(src[key], key);
        if (val !== undefined) out[key] = val;
      }
      if (where === 'query') Object.defineProperty(req, 'query', { value: out, writable: true, configurable: true });
      else req[where] = out;
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { v: value, validate, normalizeEmail, validEmail };
