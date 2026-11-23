// Ad photos: up to 8 per upload, saved in server/uploads/listings with random names.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const { UPLOADS_DIR: UPLOADS } = require('../config/storage'); // server/uploads, or DATA_DIR/uploads on a persistent disk
const LISTINGS = path.join(UPLOADS, 'listings');
const TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

exports.listingImageUrl = (filename) => `/uploads/listings/${filename}`;

// file signatures ("magic bytes") of the image types we accept
function realImage(file, mimetype) {
  let other;
  try {
    const fd = fs.openSync(file, 'r');
    other = Buffer.alloc(16);
    fs.readSync(fd, other, 0, 16, 0);
    fs.closeSync(fd);
  } catch {
    return false;
  }
  const hex = other.toString('hex');
  switch (mimetype) {
    case 'image/jpeg': return hex.startsWith('ffd8ff');
    case 'image/png': return hex.startsWith('89504e470d0a1a0a');
    case 'image/gif': return other.toString('ascii', 0, 6) === 'GIF87a' || other.toString('ascii', 0, 6) === 'GIF89a';
    case 'image/webp': return other.toString('ascii', 0, 4) === 'RIFF' && other.toString('ascii', 8, 12) === 'WEBP';
    default: return false;
  }
}
exports.realImage = realImage;

const listingUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(LISTINGS, { recursive: true });
      cb(null, LISTINGS);
    },
    // Random filename: never trust the uploaded name
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + TYPES[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 8, fields: 60, fieldSize: 100 * 1024, parts: 80 }, // 5 MB each (phone photos)
  fileFilter: (req, file, cb) =>
    TYPES[file.mimetype] ? cb(null, true) : cb(Object.assign(new Error('Only JPG, PNG, WEBP or GIF images are allowed'), { status: 400 })),
});

// Wrap so multer errors (e.g. file too large) become clean 400 responses
exports.listingImages = (req, res, next) =>
  listingUpload.array('images', 8)(req, res, (err) => {
    if (!err) {
      // the browser's "type" can be faked: check each file's first bytes really are that kind of image
      const bad = (req.files || []).filter((file) => !realImage(file.path, file.mimetype));
      if (!bad.length) return next();
      for (const item of req.files || []) fs.promises.unlink(item.path).catch(() => {});
      req.files = [];
      require('../security/audit').audit(req, 'upload.rejected', { outcome: 'denied', detail: `${bad.length} file(s) are not real images` });
      return next(Object.assign(new Error('Only real JPG, PNG, WEBP or GIF photos can be uploaded'), { status: 400 }));
    }
    if (err.code === 'LIMIT_FILE_SIZE') err.message = 'A photo is too large (max 5 MB each)';
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') err.message = 'You can add up to 8 photos';
    err.status = 400;
    next(err);
  });

// Delete a stored ad photo given its public URL
exports.removeListingImage = (url) => {
  if (!url || !url.startsWith('/uploads/listings/')) return;
  fs.promises.unlink(path.join(LISTINGS, path.basename(url))).catch(() => {});
};
