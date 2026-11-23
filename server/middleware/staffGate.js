// The staff login lives at a private link (/staff/<key>). The key is stored in the database (never sent to
// the public site), and the staff login API answers "not found" unless the request carries it.
const crypto = require('crypto');
const SiteSettings = require('../models/SiteSettings');

let gate = '';

const newKey = () => crypto.randomBytes(15).toString('base64url'); // 20 characters

async function loadGate() {
  const doc = await SiteSettings.findOne({ key: 'site' }).select('staffGate').lean();
  if (doc?.staffGate) gate = doc.staffGate;
  else {
    gate = newKey();
    await SiteSettings.updateOne({ key: 'site' }, { $set: { staffGate: gate } }, { upsert: true });
  }
  return gate;
}

async function rotateGate() {
  gate = newKey();
  await SiteSettings.updateOne({ key: 'site' }, { $set: { staffGate: gate } }, { upsert: true });
  return gate;
}

const same = (value, other) => {
  const buffer = Buffer.from(String(value || ''));
  const currentBuffer = Buffer.from(String(other || ''));
  return buffer.length === currentBuffer.length && crypto.timingSafeEqual(buffer, currentBuffer);
};
const gateOk = (key) => !!gate && same(key, gate);

// the key comes in the X-Staff-Gate header, or from the httpOnly cookie set when the private link was opened
const gateFrom = (req) => req.get('x-staff-gate') || require('../security/session').readCookie(req, 'os_gate');
// for the login endpoints: without the right key they look like they don't exist
const requireGate = (req, res, next) => (gateOk(gateFrom(req)) ? next() : res.status(404).json({ message: 'Not found' }));
// remember the private link on this device in a cookie scripts can't read (instead of localStorage)
function rememberGate(req, res) {
  const { setCookie, secureReq } = require('../security/session');
  setCookie(res, 'os_gate', gate, { maxAge: 90 * 24 * 3600e3, sameSite: 'strict', secure: secureReq(req) });
}

module.exports = { loadGate, rotateGate, gateOk, requireGate, rememberGate, gateFrom, currentGate: () => gate };
