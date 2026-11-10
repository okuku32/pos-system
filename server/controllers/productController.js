const Product = require('../models/Product');
const asyncHandler = require('../utils/asyncHandler');
const { removeImageFile } = require('../middleware/upload');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FIELDS = ['name', 'sku', 'barcode', 'category', 'price', 'cost', 'stock', 'lowStockThreshold', 'active', 'discountPercent', 'taxType', 'etimsClassCode'];
const { withPricing, clampPct } = require('../utils/pricing');
const pick = (body) => {
  const o = Object.fromEntries(FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, body[f]]));
  if (o.discountPercent !== undefined) o.discountPercent = clampPct(o.discountPercent);
  return o;
};

exports.list = asyncHandler(async (req, res) => {
  const { q, category, all } = req.query;
  const filter = all === 'true' ? {} : { active: true };
  if (category && category !== 'All') filter.category = category;
  if (q) {
    const rx = new RegExp(escapeRegex(String(q)), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { barcode: rx }];
  }
  const list = await Product.find(filter).select(req.user.role === 'admin' ? '' : '-cost').sort('name');
  res.json(list.map(withPricing));
});

exports.categories = asyncHandler(async (req, res) => {
  res.json((await Product.distinct('category', { active: true })).sort());
});

exports.create = asyncHandler(async (req, res) => {
  const data = pick(req.body);
  if (data.sku === '') delete data.sku;
  res.status(201).json(withPricing(await Product.create(data)));
});

exports.update = asyncHandler(async (req, res) => {
  const data = pick(req.body);
  const unset = {};
  if (data.sku === '') { delete data.sku; unset.sku = 1; }
  const p = await Product.findByIdAndUpdate(req.params.id, { $set: data, $unset: unset }, { returnDocument: 'after', runValidators: true });
  if (!p) return res.status(404).json({ message: 'Product not found' });
  res.json(withPricing(p));
});

exports.remove = asyncHandler(async (req, res) => {
  const p = await Product.findByIdAndDelete(req.params.id);
  if (p) removeImageFile(p.image);
  res.json({ message: 'Product deleted' });
});

// POST /api/products/:id/image  (multipart/form-data, field "image")
exports.uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No image uploaded' });
  const p = await Product.findById(req.params.id);
  if (!p) {
    removeImageFile('/uploads/products/' + req.file.filename);
    return res.status(404).json({ message: 'Product not found' });
  }
  const old = p.image;
  p.image = '/uploads/products/' + req.file.filename;
  await p.save();
  removeImageFile(old);
  res.json(p);
});

// DELETE /api/products/:id/image
exports.removeImage = asyncHandler(async (req, res) => {
  const p = await Product.findById(req.params.id);
  if (!p) return res.status(404).json({ message: 'Product not found' });
  removeImageFile(p.image);
  p.image = '';
  await p.save();
  res.json(p);
});
