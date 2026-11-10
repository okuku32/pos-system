const jwt = require('jsonwebtoken');
const Customer = require('../models/Customer');

// Customer tokens carry typ:'customer'; staff tokens never do.
exports.signCustomer = (id) => jwt.sign({ id, typ: 'customer' }, process.env.JWT_SECRET, { expiresIn: '30d' });

exports.verifyCustomerToken = async (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.typ !== 'customer') return null;
  const c = await Customer.findById(decoded.id);
  return c && c.active ? c : null;
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
