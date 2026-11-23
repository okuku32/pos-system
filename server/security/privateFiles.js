// Private files: riders' documents (ID, driving licence, insurance…) and the photos buyers send to a seller.
// They live in server/private/<bucket>/ — OUTSIDE the public /uploads folder — so they are never served as static
// files. They are streamed only after the controller has checked who is asking (the owner, the other party, or a
// staff member, whose views are written to the audit log). Never committed to git (server/.gitignore: private/).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { realImage } = require('../middleware/upload');

const ROOT = require('../config/storage').PRIVATE_DIR; // server/private, or DATA_DIR/private on a persistent disk
const IMAGES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const DOCS = { ...IMAGES, 'application/pdf': '.pdf' };
const TYPE_OF = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' };

const dirOf = (bucket) => path.join(ROOT, bucket);
// only names we made ourselves (24 hex characters + a known extension): nothing like ../ ever reaches the disk
const safeName = (name) => /^[a-f0-9]{24}\.(jpg|png|webp|pdf)$/.test(String(name || ''));

function realFile(file, mimetype) {
  if (mimetype !== 'application/pdf') return realImage(file, mimetype);
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(5);
    fs.readSync(fd, head, 0, 5, 0);
    fs.closeSync(fd);
    return head.toString('ascii') === '%PDF-';
  } catch {
    return false;
  }
}

// middleware: up to `max` files in `field`, checked by their first bytes (the browser's type can be faked)
function uploader(bucket, { field = 'file', max = 1, pdf = false, sizeMb = 8 } = {}) {
  const types = pdf ? DOCS : IMAGES;
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        fs.mkdirSync(dirOf(bucket), { recursive: true });
        cb(null, dirOf(bucket));
      },
      filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + types[file.mimetype]),
    }),
    limits: { fileSize: sizeMb * 1024 * 1024, files: max, fields: 20, fieldSize: 20 * 1024, parts: 30 },
    fileFilter: (req, file, cb) => (types[file.mimetype] ? cb(null, true) : cb(Object.assign(new Error(pdf ? 'Only a photo (JPG, PNG, WEBP) or a PDF can be uploaded' : 'Only JPG, PNG or WEBP photos can be uploaded'), { status: 400 }))),
  });
  return (req, res, next) => upload.array(field, max)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') err.message = `A file is too large (max ${sizeMb} MB)`;
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') err.message = `You can add up to ${max} file${max === 1 ? '' : 's'}`;
      err.status = 400;
      return next(err);
    }
    const bad = (req.files || []).filter((file) => !realFile(file.path, file.mimetype));
    if (!bad.length) return next();
    discard(req);
    require('./audit').audit(req, 'upload.rejected', { outcome: 'denied', detail: `${bad.length} private file(s) are not what they claim to be` });
    next(Object.assign(new Error(pdf ? 'Only real photos or PDF documents can be uploaded' : 'Only real JPG, PNG or WEBP photos can be uploaded'), { status: 400 }));
  });
}

// remove the files of a request that failed
function discard(req) {
  for (const file of req.files || []) fs.promises.unlink(file.path).catch(() => {});
  req.files = [];
}

function remove(bucket, name) {
  if (safeName(name)) fs.promises.unlink(path.join(dirOf(bucket), name)).catch(() => {});
}

// stream a file to someone already allowed to see it: never cached, never sniffed, shown inline
function send(res, bucket, name, downloadName = 'document') {
  if (!safeName(name)) return res.status(404).json({ message: 'File not found' });
  const file = path.join(dirOf(bucket), name);
  if (!fs.existsSync(file)) return res.status(404).json({ message: 'File not found' });
  const ext = path.extname(name);
  res.set({
    'Content-Type': TYPE_OF[ext],
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'Content-Disposition': `inline; filename="${String(downloadName).replace(/[^\w.-]+/g, '-').slice(0, 60)}${ext}"`,
  });
  return fs.createReadStream(file).pipe(res);
}

// copy a private photo into the public ad photos (the seller chose to use the buyer's photo in their ad)
function copyToListings(bucket, name) {
  if (!safeName(name) || name.endsWith('.pdf')) return null;
  const listings = path.join(require('../config/storage').UPLOADS_DIR, 'listings');
  fs.mkdirSync(listings, { recursive: true });
  const copy = crypto.randomBytes(12).toString('hex') + path.extname(name);
  try {
    fs.copyFileSync(path.join(dirOf(bucket), name), path.join(listings, copy));
  } catch {
    return null;
  }
  return require('../middleware/upload').listingImageUrl(copy);
}

module.exports = { uploader, discard, remove, send, copyToListings, safeName, ROOT };
