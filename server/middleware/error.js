exports.notFound = (req, res) => res.status(404).json({ message: `Not found: ${req.originalUrl}` });

// eslint-disable-next-line no-unused-vars
exports.errorHandler = (err, req, res, next) => {
  console.error(err);
  let status = err.status || 500;
  let message = err.message || 'Server error';
  if (err.code === 11000) {
    status = 400;
    message = `Duplicate value for ${Object.keys(err.keyValue).join(', ')}`;
  }
  if (err.name === 'ValidationError' || err.name === 'CastError') status = 400;
  res.status(status).json({ message });
};
