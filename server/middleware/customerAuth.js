const jwt = require('jsonwebtoken');
const Customer = require('../models/Customer');
const session = require('../security/session');

// Customer sessions (buyers, sellers, riders, shopping agents). The login creates a server-side session;
// the browser keeps it in an httpOnly cookie, API clients may send it as a Bearer token.
exports.issueCustomer = (req, res, customer) => session.issue(req, res, 'customer', customer);

const load = async (id, iat) => {
  const customer = await Customer.findById(id);
  if (!customer || !customer.active) return null;
  // a password change / reset signs out every device that logged in before it
  if (customer.passwordChangedAt && iat * 1000 < customer.passwordChangedAt.getTime() - 1000) return null;
  return customer;
};

// a token → the customer (or null). Used by the API and the live-updates socket.
exports.verifyCustomerToken = async (token) => {
  const decoded = await session.check(token, 'customer');
  if (!decoded) return null;
  const record = await load(decoded.id, decoded.iat);
  if (record) record.$locals.sessionKey = decoded.sessionKey;
  return record;
};

// tokens from before server-side sessions (no session id): accepted ONLY to be swapped for a session once
exports.verifyLegacyToken = async (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (decoded.typ !== 'customer' || decoded.sid) return null;
    return load(decoded.id, decoded.iat);
  } catch {
    return null;
  }
};

exports.protectCustomer = async (req, res, next) => {
  const { token } = session.tokenFrom(req, 'customer');
  if (!token) return res.status(401).json({ message: 'Please log in to continue' });
  try {
    const tokenValue = await exports.verifyCustomerToken(token);
    if (!tokenValue) return res.status(401).json({ message: 'Your session has expired, please log in again' });
    req.customer = tokenValue;
    req.customerSession = tokenValue.$locals.sessionKey;
    next();
  } catch (error) {
    next(error);
  }
};

// Public pages that show a little more to a logged-in customer (e.g. "this is your ad"): never blocks
exports.optionalCustomer = async (req, res, next) => {
  const { token } = session.tokenFrom(req, 'customer');
  if (token) {
    try {
      req.customer = (await exports.verifyCustomerToken(token)) || undefined;
      if (req.customer) req.customerSession = req.customer.$locals.sessionKey;
    } catch {
      /* treat as a visitor */
    }
  }
  next();
};
