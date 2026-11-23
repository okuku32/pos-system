const User = require('../models/User');
const session = require('../security/session');
const { staffMay } = require('../security/rbac');

// Staff (admin / moderator) sessions: a live server-side session (httpOnly cookie or Bearer token) AND the
// account's tokenVersion, so disabling an account, resetting its password or "sign out everywhere" ends
// every open session at once.
exports.protect = async (req, res, next) => {
  const { token } = session.tokenFrom(req, 'staff');
  if (!token) return res.status(401).json({ message: 'Please sign in' });
  try {
    const decoded = await session.check(token, 'staff');
    if (!decoded) return res.status(401).json({ message: 'Your session has ended. Please sign in again.' });
    const user = await User.findById(decoded.id);
    if (!user || !user.active) return res.status(401).json({ message: 'Your staff account is disabled' });
    if ((decoded.tv || 0) !== (user.tokenVersion || 0)) {
      session.revoke(decoded.sessionKey, 'signed out everywhere').catch(() => {});
      return res.status(401).json({ message: 'You were signed out. Please sign in again.' });
    }
    req.user = user;
    req.staffSession = decoded.sessionKey;
    // a new / reset account must choose its own password before doing anything else
    if (user.mustChangePassword && !/^\/api\/auth\/(me|password|logout)$/.test(req.originalUrl.split('?')[0])) {
      return res.status(403).json({ message: 'Please choose a new password first', code: 'CHANGE_PASSWORD' });
    }
    next();
  } catch (error) {
    next(error);
  }
};

// owners and admins (the whole admin panel)
exports.adminOnly = (req, res, next) => {
  if (!User.isAdminLevel(req.user?.role)) return res.status(403).json({ message: 'Admin access required' });
  next();
};
// the owner only (admins and owners, money settings)
exports.ownerOnly = (req, res, next) => {
  if (req.user?.role !== 'owner') return res.status(403).json({ message: 'Only the owner can do this' });
  next();
};

// a part of the admin panel (ads, sellers, orders, support): admins always, moderators if the admin allowed it
exports.can = (area) => (req, res, next) => {
  if (!staffMay(req.user, `area.${area}`)) return res.status(403).json({ message: `You don’t have access to ${area}. Ask an admin.` });
  next();
};
