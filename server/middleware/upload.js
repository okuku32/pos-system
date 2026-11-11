const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const UPLOADS = path.join(__dirname, '..', 'uploads');
const { currentTenant } = require('../tenancy/context');
const { DEFAULT_SLUG } = require('../tenancy/tenants');
// The original shop keeps uploads/products; other clients get uploads/<client>/products
const folderFor = (t = currentTenant()) => (!t || t.slug === DEFAULT_SLUG() ? 'products' : `${t.slug}/products`);
const dirFor = () => {
  const d = path.join(UPLOADS, folderFor());
  fs.mkdirSync(d, { recursive: true });
  return d;
};
exports.imageUrl = (filename) => `/uploads/${folderFor()}/${filename}`;

const TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, dirFor()),
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
  if (!url || !url.startsWith(`/uploads/${folderFor()}/`)) return; // only this client's own pictures
  const file = path.join(UPLOADS, folderFor(), path.basename(url));
  fs.promises.unlink(file).catch(() => {});
};

// ----- Marketplace ad photos: up to 8 per upload, in uploads/listings (or uploads/<client>/listings)
const listingFolder = (t = currentTenant()) => (!t || t.slug === DEFAULT_SLUG() ? 'listings' : `${t.slug}/listings`);
exports.listingImageUrl = (filename) => `/uploads/${listingFolder()}/${filename}`;
const listingUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const d = path.join(UPLOADS, listingFolder());
      fs.mkdirSync(d, { recursive: true });
      cb(null, d);
    },
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + TYPES[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 8 }, // 5 MB each (phone photos)
  fileFilter: (req, file, cb) =>
    TYPES[file.mimetype] ? cb(null, true) : cb(Object.assign(new Error('Only JPG, PNG, WEBP or GIF images are allowed'), { status: 400 })),
});
exports.listingImages = (req, res, next) =>
  listingUpload.array('images', 8)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') err.message = 'A photo is too large (max 5 MB each)';
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') err.message = 'You can add up to 8 photos';
    err.status = 400;
    next(err);
  });
exports.removeListingImage = (url) => {
  if (!url || !url.startsWith(`/uploads/${listingFolder()}/`)) return;
  fs.promises.unlink(path.join(UPLOADS, listingFolder(), path.basename(url))).catch(() => {});
};
