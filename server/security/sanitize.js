// Incoming data hygiene for every request (body, query string, URL parameters):
//  - NoSQL injection: keys starting with "$" or containing "." are dropped ({"$ne": null}, {"$gt": ""}),
//    so a value can never turn into a database operator.
//  - Prototype pollution: "__proto__", "constructor", "prototype" keys are dropped.
//  - XSS: HTML tags and javascript: URLs are removed from text (passwords, tokens and secrets are left alone).
//  - Size limits: deep nesting, huge arrays and very long strings are refused.
const BAD_KEY = /^\$|\.|^__proto__$|^constructor$|^prototype$/;
const RAW_FIELD = /pass(word)?|token|secret|credential|passkey|signature|csrf|key$/i; // compared, never displayed: keep exact
const TAG = /<\/?[a-zA-Z!?][^<>]*>/g;
const SCRIPTY = /(?:javascript|vbscript|data:text\/html)\s*:/gi;
const LIMITS = { depth: 8, array: 500, string: 20000, keys: 300 };

class Refused extends Error {
  constructor(match) {
    super(match);
    this.status = 400;
  }
}

function cleanString(string, key) {
  let text = string.replace(/\u0000/g, '');
  if (text.length > LIMITS.string) throw new Refused('A field is too long');
  if (key && RAW_FIELD.test(key)) return text;
  if (text.includes('<') || /script\s*:|data:text/i.test(text)) text = text.replace(TAG, '').replace(SCRIPTY, '').replace(/[<>]/g, '');
  return text;
}

function clean(value, key, depth = 0, removed = []) {
  if (depth > LIMITS.depth) throw new Refused('The request is nested too deeply');
  if (typeof value === 'string') return cleanString(value, key);
  if (Array.isArray(value)) {
    if (value.length > LIMITS.array) throw new Refused('Too many items in the request');
    return value.map((item) => clean(item, key, depth + 1, removed));
  }
  if (value && typeof value === 'object') {
    if (Object.prototype.toString.call(value) !== '[object Object]') return value;
    const out = {};
    const keys = Object.keys(value);
    if (keys.length > LIMITS.keys) throw new Refused('Too many fields in the request');
    for (const entryKey of keys) {
      if (BAD_KEY.test(entryKey)) {
        removed.push(entryKey);
        continue;
      }
      out[entryKey] = clean(value[entryKey], entryKey, depth + 1, removed);
    }
    return out;
  }
  return value;
}

function sanitizeRequest(req, res, next) {
  try {
    const removed = [];
    if (req.body && typeof req.body === 'object') req.body = clean(req.body, '', 0, removed);
    // Express 5: req.query is a getter, so replace it with the cleaned copy
    const query = clean({ ...req.query }, '', 0, removed);
    Object.defineProperty(req, 'query', { value: query, writable: true, configurable: true, enumerable: true });
    if (removed.length) require('./audit').audit(req, 'input.operator_removed', { outcome: 'denied', detail: `dropped keys: ${[...new Set(removed)].slice(0, 10).join(', ')}` });
    next();
  } catch (error) {
    next(error);
  }
}

// URL parameters that must be database ids (…/:id) — anything else is a 404, never reaches a query
const OBJECT_ID = /^[a-f0-9]{24}$/i;
function guardIds(router, names = ['id', 'listingId', 'conversationId', 'messageId', 'paymentId', 'worker']) {
  for (const name of names) {
    router.param(name, (req, res, next, value) => (OBJECT_ID.test(String(value)) ? next() : res.status(404).json({ message: 'Not found' })));
  }
  return router;
}

module.exports = { sanitizeRequest, guardIds, clean, cleanString, OBJECT_ID };
