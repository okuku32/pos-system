const jwt = require('jsonwebtoken');
const Customer = require('../models/Customer');
const { requireTenant, currentTenant } = require('../tenancy/context');
const { tokenMatchesTenant } = require('../tenancy/tokens');

// Customer tokens carry typ:'customer'; staff tokens never do.
exports.signCustomer = (id) => jwt.sign({ id, typ: 'customer', tid: requireTenant().slug }, process.env.JWT_SECRET, { expiresIn: '30d' });

exports.verifyCustomerToken = async (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.typ !== 'customer') return null;
  if (!tokenMatchesTenant(decoded, currentTenant())) return null; // customer account of a different shop
  const c = await Customer.findById(decoded.id);
  if (!c || !c.active) return null;
  // a password reset signs out every device that logged in before it
  if (c.passwordChangedAt && decoded.iat * 1000 < c.passwordChangedAt.getTime() - 1000) return null;
  return c;
};

exports.protectCustomer = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Please log in to continue' });
  try {
    const c = await exports.verifyCustomerToken(token);
    if (!c) return res.status(401).json({ message: 'Please log in to continue' });
    req.customer = c;
    next();
  } catch {
    res.status(401).json({ message: 'Your session has expired, please log in again' });
  }
};

// Public pages that show a little more to a logged-in customer (e.g. "this is your ad"): never blocks
exports.optionalCustomer = async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    try {
      req.customer = (await exports.verifyCustomerToken(header.slice(7))) || undefined;
    } catch {
      /* expired or invalid: treat as a visitor */
    }
  }
  next();
};
