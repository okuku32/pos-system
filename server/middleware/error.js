// Error responses that never expose internals: no stack traces, database details, file paths or field names
// beyond what the user typed. Server errors get a short reference id; the details go to the server log only.
const crypto = require('crypto');

exports.notFound = (req, res) => res.status(404).json({ message: 'Not found' });

const DUP_FIELDS = { email: 'email address', phone: 'phone number', slug: 'address', orderNo: 'order number' };

// eslint-disable-next-line no-unused-vars
exports.errorHandler = (err, req, res, next) => {
  let status = Number(err.status || err.statusCode) || 500;
  let message = err.message || '';

  if (err.type === 'entity.parse.failed') [status, message] = [400, 'The request could not be read (invalid JSON).'];
  else if (err.type === 'entity.too.large') [status, message] = [413, 'The request is too large.'];
  else if (err.code === 11000) {
    const field = Object.keys(err.keyValue || err.keyPattern || {})[0];
    [status, message] = [409, `That ${DUP_FIELDS[field] || 'value'} is already in use.`];
  } else if (err.name === 'CastError') [status, message] = [400, 'Invalid value in the request.'];
  else if (err.name === 'ValidationError') {
    status = 400;
    const first = Object.values(err.errors || {})[0];
    message = first?.kind === 'required' ? 'Please fill in all the required fields.' : 'Some details are not valid. Please check and try again.';
  } else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') [status, message] = [401, 'Your session has ended. Please sign in again.'];

  if (status < 400 || status > 599) status = 500;
  if (status >= 500) {
    const ref = crypto.randomBytes(4).toString('hex');
    console.error(`[error ${ref}] ${req.method} ${require('../security/env').redactUrl(req.originalUrl)}`, err);
    if (res.headersSent) return;
    return res.status(status).json({ message: `Something went wrong on our side. Please try again. (ref ${ref})`, ref });
  }
  if (res.headersSent) return;
  res.status(status).json({ message: String(message || 'Request failed').slice(0, 300), ...(err.code && typeof err.code === 'string' && /^[A-Z_]+$/.test(err.code) ? { code: err.code } : {}) });
};
