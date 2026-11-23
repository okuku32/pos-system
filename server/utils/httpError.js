// An error with an HTTP status, turned into a clean JSON response by middleware/error.js
module.exports = (message, status = 400) => Object.assign(new Error(message), { status });
