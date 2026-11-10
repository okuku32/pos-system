const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const DIR = path.join(__dirname, '..', 'uploads', 'products');
fs.mkdirSync(DIR, { recursive: true });

const TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const upload = multer({
  storage: multer.diskStorage({
    destination: DIR,
    // Random filename: never trust the uploaded name
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + TYPES[file.mimetype]),
  }),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
  fileFilter: (req, file, cb) =>
    TYPES[file.mimetype]
      ? cb(null, true)
      : cb(Object.assign(new Error('Only JPG, PNG, WEBP or GIF images are allowed'), { status: 400 })),
});

// Wrap so multer errors (e.g. file too large) become clean 400 responses
exports.productImage = (req, res, next) =>
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') err.message = 'Image is too large (max 3 MB)';
    err.status = 400;
    next(err);
  });

// Delete a previously stored image given its public URL (/uploads/products/<file>)
exports.removeImageFile = (url) => {
  if (!url || !url.startsWith('/uploads/products/')) return;
  const file = path.join(DIR, path.basename(url));
  fs.promises.unlink(file).catch(() => {});
};
