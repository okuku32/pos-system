const jwt = require('jsonwebtoken');
const User = require('../models/User');
const StaffEvent = require('../models/StaffEvent');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const { verifyGoogleCredential, googleClientId } = require('../utils/oauth');
const { rotateGate, currentGate } = require('../middleware/staffGate');

const SESSION = '12h'; // staff sign in again every day
const MAX_FAILS = 5; // wrong passwords before the account is locked…
const LOCK_MINUTES = 15; // …for this long
const session = require('../security/session');
const { audit } = require('../security/audit');
void SESSION; void jwt; // sessions: see security/session.js (12 h, 4 h idle)
const sign = (req, res, user) => session.issue(req, res, 'staff', user, { tv: user.tokenVersion || 0 });
const publicUser = (user) => ({
  _id: user._id, name: user.name, email: user.email, role: user.role, active: user.active,
  perms: User.isAdminLevel(user.role) ? [...User.PERMS] : user.perms || [], mustChangePassword: !!user.mustChangePassword,
  lastLoginAt: user.lastLoginAt || null, lastLoginIp: user.lastLoginIp || '', createdAt: user.createdAt,
  locked: !!(user.lockedUntil && user.lockedUntil > new Date()),
});
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim().slice(0, 60);
const log = (req, user, action, extra = {}) =>
  audit(req, `staff.${action}`, { outcome: /failed|locked/.test(action) ? 'failed' : 'ok', actor: { kind: user ? 'staff' : 'anonymous', id: user?._id, name: user?.email || extra.email }, detail: extra.detail }) ||
  StaffEvent.create({ user: user?._id, email: user?.email || extra.email, name: user?.name, action, ip: ipOf(req), ...extra }).catch(() => {});
const clean = (text, max) => String(text ?? '').replace(/[<>]/g, '').trim().slice(0, max);

// a staff password: 8+ characters with letters and numbers
function strongPassword(value) {
  const entryValue = String(value || '');
  if (entryValue.length < 8 || !/[A-Za-z]/.test(entryValue) || !/\d/.test(entryValue)) throw httpError('Use a password of at least 8 characters with letters and numbers');
  if (/^(admin|password|cashier|kapu)\d*$/i.test(entryValue)) throw httpError('That password is too easy to guess');
  return entryValue;
}

// brute-force guard per IP (in memory) on top of the per-account lock (in the database)
const ipFails = new Map();
function ipBlocked(ip) {
  const currentIpFail = ipFails.get(ip);
  if (!currentIpFail) return false;
  if (Date.now() - currentIpFail.first > LOCK_MINUTES * 60000) return ipFails.delete(ip) && false;
  return currentIpFail.n >= 20;
}
const ipFail = (ip) => {
  const currentIpFail = ipFails.get(ip);
  if (!currentIpFail || Date.now() - currentIpFail.first > LOCK_MINUTES * 60000) ipFails.set(ip, { n: 1, first: Date.now() });
  else currentIpFail.n++;
};

async function signedIn(req, res, user) {
  user.failedLogins = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  user.lastLoginIp = ipOf(req);
  await user.save();
  log(req, user, 'login');
  res.json({ token: await sign(req, res, user), user: publicUser(user) });
}

// POST /api/auth/login { email, password }   (only with the private staff link's key)
exports.login = asyncHandler(async (req, res) => {
  const ip = ipOf(req);
  if (ipBlocked(ip)) throw httpError(`Too many attempts from this network. Try again in ${LOCK_MINUTES} minutes.`, 429);
  const email = clean(req.body.email, 120).toLowerCase();
  const user = await User.findOne({ email }).select('+password');
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil - Date.now()) / 60000);
    throw httpError(`This account is locked after too many wrong passwords. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or ask an admin to unlock it.`, 429);
  }
  const pw = String(req.body.password || '');
  if (!user || !user.active || !(await user.matchPassword(pw))) {
    ipFail(ip);
    if (user) {
      user.failedLogins = (user.failedLogins || 0) + 1;
      if (user.failedLogins >= MAX_FAILS) {
        user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
        user.failedLogins = 0;
        log(req, user, 'locked', { detail: `${MAX_FAILS} wrong passwords` });
      } else log(req, user, 'login_failed');
      await user.save();
    } else log(req, null, 'login_failed', { email, detail: 'unknown email' });
    throw httpError('Wrong email or password', 401);
  }
  if (user.needsRehash()) user.password = pw; // upgraded to today's bcrypt cost on save
  await signedIn(req, res, user);
});

exports.me = (req, res) => res.json(publicUser(req.user));

// GET /api/auth/gate: is this staff link right? (requireGate answers 404 when it isn't)
exports.gate = (req, res) => {
  require('../middleware/staffGate').rememberGate(req, res); // this device remembers the private link (httpOnly cookie)
  res.json({ ok: true });
};

// GET /api/auth/oauth-config: which sign-in providers the browser should show
exports.oauthConfig = (req, res) => res.json({ google: googleClientId() });

// POST /api/auth/oauth/google { credential }: only for an email an admin already added under Team
exports.google = asyncHandler(async (req, res) => {
  const verifyGoogleCredentialResult = await verifyGoogleCredential(req.body.credential);
  const user = await User.findOne({ email: verifyGoogleCredentialResult.email });
  if (!user || !user.active) {
    log(req, null, 'login_failed', { email: verifyGoogleCredentialResult.email, detail: 'Google: not a staff account' });
    return res.status(403).json({ message: `${verifyGoogleCredentialResult.email} is not a staff account. Ask an admin to add you under Admin → Team.` });
  }
  await signedIn(req, res, user);
});

// First-run setup: allowed only when no staff accounts exist yet
exports.setupStatus = asyncHandler(async (req, res) => {
  res.json({ needsSetup: (await User.countDocuments()) === 0 });
});
exports.setup = asyncHandler(async (req, res) => {
  if (await User.countDocuments()) throw httpError('Setup already completed');
  const name = clean(req.body.name, 60);
  if (name.length < 2) throw httpError('Please enter your name');
  // the first account owns the marketplace
  const user = await User.create({ name, email: clean(req.body.email, 120), password: strongPassword(req.body.password), role: 'owner' });
  await signedIn(req, res, user);
});

// POST /api/auth/password { current, next }: change my own password (also ends my other sessions)
exports.changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.matchPassword(String(req.body.current || '')))) throw httpError('Your current password is wrong');
  const next = strongPassword(req.body.next);
  if (await user.matchPassword(next)) throw httpError('Choose a password different from the current one');
  user.password = next;
  user.mustChangePassword = false;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  log(req, user, 'password_changed');
  await session.revokeAll('staff', user._id, 'password changed');
  res.json({ token: await sign(req, res, user), user: publicUser(user), message: 'Password changed. Other devices were signed out.' });
});

// POST /api/auth/logout: ends this session
exports.logout = asyncHandler(async (req, res) => {
  if (req.staffSession) await session.revoke(req.staffSession, 'logout');
  session.clearCookie(res, session.POLICY.staff.cookie, req);
  log(req, req.user, 'logout');
  res.json({ message: 'Signed out' });
});

// POST /api/auth/session: swap a staff token kept by an older version of the admin panel for a session cookie
exports.session = asyncHandler(async (req, res) => {
  await sign(req, res, req.user);
  res.json({ user: publicUser(req.user) });
});

// ---------------------------------------------------------------- admin: team
// the other active owners (there must always be at least one)
const otherActiveOwners = (exceptId) => User.countDocuments({ role: 'owner', active: true, _id: { $ne: exceptId } });
// owners and admins can only be added, changed or removed by an owner (an admin manages moderators only)
const roleFrom = (value) => (User.ROLES.includes(value) ? value : 'moderator');
function mayManage(actor, targetRole) {
  if (actor.role === 'owner') return true;
  return actor.role === 'admin' && targetRole === 'moderator';
}
const cleanPerms = (perms) => (Array.isArray(perms) ? [...new Set(perms.filter((perm) => User.PERMS.includes(perm)))] : undefined);

exports.listUsers = asyncHandler(async (req, res) => {
  res.json((await User.find().sort('-createdAt').lean()).map(publicUser));
});

exports.createUser = asyncHandler(async (req, res) => {
  const name = clean(req.body.name, 60);
  const email = clean(req.body.email, 120).toLowerCase();
  if (name.length < 2) throw httpError('Please enter their name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw httpError('Please enter a valid email');
  if (await User.exists({ email })) throw httpError('A staff account with that email already exists', 409);
  const role = roleFrom(req.body.role);
  if (!mayManage(req.user, role)) throw httpError('Only the owner can add admins or owners', 403);
  const user = await User.create({
    name, email, role, password: strongPassword(req.body.password), createdBy: req.user._id,
    perms: User.isAdminLevel(role) ? [...User.PERMS] : cleanPerms(req.body.perms) ?? [...User.PERMS],
    mustChangePassword: req.body.mustChangePassword !== false, // they pick their own password at first sign-in
  });
  log(req, user, 'user_created', { by: req.user.name, detail: `${role}${role === 'moderator' ? `: ${user.perms.join(', ') || 'no areas'}` : ''}` });
  res.status(201).json(publicUser(user));
});

exports.updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw httpError('Staff account not found', 404);
  const me = String(req.user._id) === String(user._id);
  // an admin may change moderators (and their own name / email / password), never another admin or an owner
  if (!me && !mayManage(req.user, user.role)) throw httpError('Only the owner can change admins or owners', 403);
  const body = req.body;
  const changes = [];
  let signOut = false;
  if (body.name !== undefined && clean(body.name, 60).length >= 2) user.name = clean(body.name, 60);
  if (body.email !== undefined) {
    const email = clean(body.email, 120).toLowerCase();
    if (email !== user.email && (await User.exists({ email }))) throw httpError('A staff account with that email already exists', 409);
    user.email = email;
  }
  if (body.role !== undefined) {
    const role = roleFrom(body.role);
    if (role !== user.role) {
      if (me) throw httpError('You can’t change your own role');
      if (!mayManage(req.user, role)) throw httpError('Only the owner can make someone an admin or an owner', 403);
      if (user.role === 'owner' && !(await otherActiveOwners(user._id))) throw httpError('There must always be at least one active owner');
      user.role = role;
      changes.push(`role → ${role}`);
      signOut = true;
    }
  }
  const perms = cleanPerms(body.perms);
  if (perms && user.role === 'moderator') {
    user.perms = perms;
    changes.push(`areas → ${perms.join(', ') || 'none'}`);
  }
  if (body.active !== undefined && !!body.active !== user.active) {
    if (me) throw httpError('You can’t disable your own account');
    if (!body.active && user.role === 'owner' && !(await otherActiveOwners(user._id))) throw httpError('There must always be at least one active owner');
    user.active = !!body.active;
    changes.push(user.active ? 'enabled' : 'disabled');
    signOut = signOut || !user.active;
  }
  if (body.password) {
    user.password = strongPassword(body.password);
    user.mustChangePassword = !me; // a password an admin set is temporary
    changes.push('password reset');
    signOut = true;
  }
  if (body.unlock) {
    user.lockedUntil = undefined;
    user.failedLogins = 0;
    changes.push('unlocked');
  }
  if (signOut) user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  if (signOut) await session.revokeAll('staff', user._id, `changed by ${req.user.email}`);
  if (changes.length) log(req, user, 'user_updated', { by: req.user.name, detail: changes.join(' · ') });
  res.json(publicUser(user));
});

// POST /api/auth/users/:id/signout: end all of their sessions now
exports.signOutUser = asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id).select('role').lean();
  if (!target) throw httpError('Staff account not found', 404);
  if (String(target._id) !== String(req.user._id) && !mayManage(req.user, target.role)) throw httpError('Only the owner can sign out admins or owners', 403);
  const user = await User.findByIdAndUpdate(req.params.id, { $inc: { tokenVersion: 1 } }, { returnDocument: 'after' });
  if (!user) throw httpError('Staff account not found', 404);
  await session.revokeAll('staff', user._id, `signed out by ${req.user.email}`);
  log(req, user, 'signed_out', { by: req.user.name });
  res.json({ message: `${user.name} was signed out on every device` });
});

exports.deleteUser = asyncHandler(async (req, res) => {
  if (String(req.user._id) === req.params.id) throw httpError('You cannot delete yourself');
  const user = await User.findById(req.params.id);
  if (!user) throw httpError('Staff account not found', 404);
  if (!mayManage(req.user, user.role)) throw httpError('Only the owner can remove admins or owners', 403);
  if (user.role === 'owner' && !(await otherActiveOwners(user._id))) throw httpError('There must always be at least one active owner');
  await user.deleteOne();
  await session.revokeAll('staff', user._id, 'account deleted');
  log(req, user, 'user_deleted', { by: req.user.name });
  res.json({ message: 'Staff account deleted' });
});

// GET /api/auth/events: recent sign-ins and team changes
exports.events = asyncHandler(async (req, res) => {
  res.json(await StaffEvent.find().sort({ at: -1 }).limit(100).lean());
});

// GET /api/auth/staff-link · POST /api/auth/staff-link (a new one; the old link stops working)
exports.staffLink = (req, res) => res.json({ path: `/staff/${currentGate()}` });
exports.newStaffLink = asyncHandler(async (req, res) => {
  const key = await rotateGate();
  log(req, req.user, 'link_changed', { by: req.user.name });
  res.json({ path: `/staff/${key}`, message: 'New staff login link created. The old link no longer works.' });
});
