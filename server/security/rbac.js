// Role-based access control: who may do what.
//
// STAFF (User model, "staff" sessions)
//   owner      → everything; the only one who manages admins / owners (team.admins) and changes money settings
//                (settings.money: commission, rider & agent fares, courier, payments, campaigns)
//   admin      → everything else: moderators, other settings, staff link and the audit log
//   moderator  → only the areas an admin ticked: ads · sellers · orders · support
//
// CUSTOMERS (Customer model, "customer" sessions) — roles come from the account, never from the request
//   buyer           → every customer: buy, chat, review own orders, Lipa Pole Pole
//   seller          → anyone with ads: manage OWN ads, OWN orders as seller, boosts
//   rider           → approved field worker (worker.role = rider): delivery jobs
//   shopping_agent  → approved field worker (worker.role = agent): inspections and courier jobs
// Object-level checks (is this MY order / ad / chat?) are done in each controller against the record itself.
const STAFF_AREAS = ['ads', 'sellers', 'orders', 'support'];

const PERMISSIONS = {
  'team.manage': ['owner', 'admin'], // moderators
  'team.admins': ['owner'], // admins and owners
  'settings.write': ['owner', 'admin'],
  'settings.money': ['owner'],
  'settings.read': ['owner', 'admin'],
  'audit.read': ['owner', 'admin'],
  'stafflink.manage': ['owner', 'admin'],
  ...Object.fromEntries(STAFF_AREAS.map((staffArea) => [`area.${staffArea}`, ['owner', 'admin', `moderator:${staffArea}`]])),
};

function staffMay(user, permission) {
  if (!user || !user.active) return false;
  const allowed = PERMISSIONS[permission] || [];
  if (allowed.includes(user.role)) return true;
  return allowed.some((item) => item.startsWith('moderator:') && user.role === 'moderator' && (user.perms || []).includes(item.split(':')[1]));
}

// customer roles, derived from the stored account
function customerRoles(customer) {
  if (!customer) return [];
  const roles = ['buyer'];
  if (customer.accountType === 'seller') roles.push('seller');
  if (customer.worker?.status === 'approved') roles.push(customer.worker.role === 'rider' ? 'rider' : 'shopping_agent');
  return roles;
}

// middleware: requires a staff permission (use after protect)
const requirePermission = (permission) => (req, res, next) =>
  staffMay(req.user, permission) ? next() : res.status(403).json({ message: 'You don’t have access to this. Ask an admin.' });

// middleware: requires one of these customer roles (use after protectCustomer)
const requireRole = (...roles) => (req, res, next) =>
  customerRoles(req.customer).some((item) => roles.includes(item)) ? next() : res.status(403).json({ message: 'Your account can’t do this.' });

module.exports = { STAFF_AREAS, PERMISSIONS, staffMay, customerRoles, requirePermission, requireRole };
