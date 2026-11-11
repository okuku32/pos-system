const Product = require('../models/Product');
const asyncHandler = require('../utils/asyncHandler');
const { removeImageFile, imageUrl } = require('../middleware/upload');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FIELDS = ['name', 'sku', 'barcode', 'category', 'price', 'cost', 'stock', 'lowStockThreshold', 'active', 'discountPercent', 'taxType', 'etimsClassCode', 'supplier', 'description'];
const mongoose = require('mongoose');
const { invalidator } = require('../utils/cache');
// What the till needs (keeps the POS product list small and fast)
const POS_FIELDS = 'name sku barcode category price discountPercent stock lowStockThreshold image active';
const { withPricing, clampPct } = require('../utils/pricing');
const pick = (body) => {
  const o = Object.fromEntries(FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, body[f]]));
  if (o.discountPercent !== undefined) o.discountPercent = clampPct(o.discountPercent);
  if (o.supplier !== undefined) {
    if (!o.supplier) o.supplier = null;
    else if (!mongoose.isValidObjectId(o.supplier)) throw Object.assign(new Error('Invalid supplier'), { status: 400 });
  }
  return o;
};

exports.list = asyncHandler(async (req, res) => {
  const { q, category, all, supplier } = req.query;
  const filter = all === 'true' ? {} : { active: true };
  if (category && category !== 'All') filter.category = category;
  if (supplier === 'none') filter.supplier = null;
  else if (supplier && mongoose.isValidObjectId(supplier)) filter.supplier = supplier;
  if (q) {
    const rx = new RegExp(escapeRegex(String(q)), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { barcode: rx }];
  }
  const isAdmin = req.user.role === 'admin';
  // Admin product page: everything incl. supplier name. Till: only the fields it shows (smaller, faster).
  let query = Product.find(filter).sort('name').lean();
  query = all === 'true' && isAdmin ? query.populate('supplier', 'name') : query.select(isAdmin ? POS_FIELDS + ' cost' : POS_FIELDS);
  res.json((await query).map(withPricing));
});

exports.categories = asyncHandler(async (req, res) => {
  res.json((await Product.distinct('category', { active: true })).sort());
});

exports.create = asyncHandler(async (req, res) => {
  res.on('finish', invalidator('catalog')); // clear this client's shop catalogue cache once saved
  const data = pick(req.body);
  if (data.sku === '') delete data.sku;
  res.status(201).json(withPricing(await Product.create(data)));
});

exports.update = asyncHandler(async (req, res) => {
  res.on('finish', invalidator('catalog')); // clear this client's shop catalogue cache once saved
  const data = pick(req.body);
  const unset = {};
  if (data.sku === '') { delete data.sku; unset.sku = 1; }
  const p = await Product.findByIdAndUpdate(req.params.id, { $set: data, $unset: unset }, { returnDocument: 'after', runValidators: true });
  if (!p) return res.status(404).json({ message: 'Product not found' });
  res.json(withPricing(p));
});

exports.remove = asyncHandler(async (req, res) => {
  res.on('finish', invalidator('catalog')); // clear this client's shop catalogue cache once saved
  const p = await Product.findByIdAndDelete(req.params.id);
  if (p) removeImageFile(p.image);
  res.json({ message: 'Product deleted' });
});

// POST /api/products/:id/image  (multipart/form-data, field "image")
exports.uploadImage = asyncHandler(async (req, res) => {
  res.on('finish', invalidator('catalog')); // clear this client's shop catalogue cache once saved
  if (!req.file) return res.status(400).json({ message: 'No image uploaded' });
  const p = await Product.findById(req.params.id);
  if (!p) {
    removeImageFile(imageUrl(req.file.filename));
    return res.status(404).json({ message: 'Product not found' });
  }
  const old = p.image;
  p.image = imageUrl(req.file.filename);
  await p.save();
  removeImageFile(old);
  res.json(p);
});

// DELETE /api/products/:id/image
exports.removeImage = asyncHandler(async (req, res) => {
  res.on('finish', invalidator('catalog')); // clear this client's shop catalogue cache once saved
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ message: 'Product not found' });
  removeImageFile(p.image);
  p.image = '';
  await p.save();
  res.json(p);
});
