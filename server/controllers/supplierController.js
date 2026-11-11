// Suppliers: who you buy from, what they supply, and what needs re-ordering.
const mongoose = require('mongoose');
const Supplier = require('../models/Supplier');
const Product = require('../models/Product');
const Purchase = require('../models/Purchase');
const asyncHandler = require('../utils/asyncHandler');
const { httpError } = require('../utils/saleService');
const { formatPhone } = require('../utils/mpesa');
const { salePrice } = require('../utils/pricing');

const FIELDS = ['name', 'contactPerson', 'phone', 'email', 'kraPin', 'address', 'paymentTerms', 'notes', 'active'];
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function pick(body) {
  const o = Object.fromEntries(FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, typeof body[f] === 'string' ? body[f].trim() : body[f]]));
  if (o.name !== undefined && o.name.length < 2) throw httpError('Enter the supplier name');
  if (o.email && !EMAIL_RX.test(o.email)) throw httpError('That email address doesn’t look right');
  if (o.kraPin && !/^[AP]\d{9}[A-Z]$/i.test(o.kraPin)) throw httpError('KRA PIN should look like P051234567X');
  if (o.phone) {
    try {
      o.phone = formatPhone(o.phone);
    } catch {
      throw httpError('Phone should be a Kenyan mobile number, e.g. 0712 345 678');
    }
  }
  return o;
}

// Per-supplier product figures in ONE query (no per-supplier round trips, so it stays fast with many suppliers)
async function productStats(supplierIds) {
  const rows = await Product.aggregate([
    { $match: { supplier: { $in: supplierIds } } },
    {
      $group: {
        _id: '$supplier',
        products: { $sum: { $cond: ['$active', 1, 0] } },
        low: { $sum: { $cond: [{ $and: ['$active', { $gt: ['$stock', 0] }, { $lte: ['$stock', { $ifNull: ['$lowStockThreshold', 5] }] }] }, 1, 0] } },
        out: { $sum: { $cond: [{ $and: ['$active', { $lte: ['$stock', 0] }] }, 1, 0] } },
        stockValue: { $sum: { $multiply: [{ $max: ['$stock', 0] }, { $ifNull: ['$cost', 0] }] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), r]));
}

// What you owe each supplier: value of goods received minus payments (one query for all suppliers)
async function owedBySupplier(supplierIds) {
  const rows = await Purchase.aggregate([
    { $match: { supplier: { $in: supplierIds }, status: { $ne: 'cancelled' } } },
    { $group: { _id: '$supplier', owed: { $sum: { $max: [{ $subtract: ['$receivedValue', '$amountPaid'] }, 0] } } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), Math.round(r.owed * 100) / 100]));
}

const duplicate = (err) => (err.code === 11000 ? httpError('A supplier with this name already exists', 409) : err);

// GET /api/suppliers?q=&status=active|archived|all&page=&limit=
exports.list = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const filter = {};
  if (req.query.status !== 'all') filter.active = req.query.status !== 'archived';
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q).slice(0, 60)), 'i');
    filter.$or = [{ name: rx }, { contactPerson: rx }, { phone: rx }, { email: rx }, { kraPin: rx }];
  }
  const [suppliers, count] = await Promise.all([
    Supplier.find(filter).collation({ locale: 'en', strength: 2 }).sort('name').skip((page - 1) * limit).limit(limit).lean(),
    Supplier.countDocuments(filter),
  ]);
  const ids = suppliers.map((s) => s._id);
  const [stats, owed] = await Promise.all([productStats(ids), owedBySupplier(ids)]);
  const unassigned = page === 1 ? await Product.countDocuments({ active: true, $or: [{ supplier: null }, { supplier: { $exists: false } }] }) : undefined;
  res.json({
    suppliers: suppliers.map((s) => ({ ...s, stats: stats.get(String(s._id)) || { products: 0, low: 0, out: 0, stockValue: 0 }, owed: owed.get(String(s._id)) || 0 })),
    count,
    page,
    pages: Math.ceil(count / limit) || 1,
    unassigned,
  });
});

// GET /api/suppliers/options: id + name of active suppliers, for the product form's dropdown
exports.options = asyncHandler(async (req, res) => {
  res.json(await Supplier.find({ active: true }, 'name').collation({ locale: 'en', strength: 2 }).sort('name').lean());
});

// GET /api/suppliers/:id: the supplier, their products, and what to re-order
exports.get = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError('Supplier not found', 404);
  const s = await Supplier.findById(req.params.id).lean();
  if (!s) throw httpError('Supplier not found', 404);
  const products = await Product.find({ supplier: s._id }, 'name sku category price cost stock lowStockThreshold discountPercent active image').sort('name').lean();
  const withStatus = products.map((p) => {
    const threshold = p.lowStockThreshold ?? 5;
    return {
      ...p,
      salePrice: salePrice(p),
      status: p.stock <= 0 ? 'out' : p.stock <= threshold ? 'low' : 'ok',
      // suggested order: bring stock back to 3× the alert level (at least 10)
      suggestedOrder: p.stock <= threshold ? Math.max(10, threshold * 3) - Math.max(0, p.stock) : 0,
    };
  });
  const active = withStatus.filter((p) => p.active);
  const purchases = await Purchase.find({ supplier: s._id }, 'purchaseNo status total receivedValue amountPaid paymentStatus createdAt expectedDate').sort('-createdAt').limit(20).lean();
  const owed = (await owedBySupplier([s._id])).get(String(s._id)) || 0;
  res.json({
    ...s,
    purchases,
    owed,
    products: withStatus,
    restock: active.filter((p) => p.status !== 'ok').sort((a, b) => a.stock - b.stock),
    stats: {
      products: active.length,
      low: active.filter((p) => p.status === 'low').length,
      out: active.filter((p) => p.status === 'out').length,
      stockValue: active.reduce((n, p) => n + Math.max(0, p.stock) * (p.cost || 0), 0),
      restockCost: active.reduce((n, p) => n + p.suggestedOrder * (p.cost || 0), 0),
    },
  });
});

exports.create = asyncHandler(async (req, res) => {
  try {
    res.status(201).json(await Supplier.create(pick(req.body)));
  } catch (err) {
    throw duplicate(err);
  }
});

exports.update = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError('Supplier not found', 404);
  try {
    const s = await Supplier.findByIdAndUpdate(req.params.id, { $set: pick(req.body) }, { returnDocument: 'after', runValidators: true }).lean();
    if (!s) throw httpError('Supplier not found', 404);
    res.json(s);
  } catch (err) {
    throw duplicate(err);
  }
});

// DELETE /api/suppliers/:id: only if no products point to it (otherwise archive it instead)
exports.remove = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError('Supplier not found', 404);
  const linked = (await Product.countDocuments({ supplier: req.params.id })) + (await Purchase.countDocuments({ supplier: req.params.id }));
  if (linked) throw httpError(`${linked} product(s) are linked to this supplier. Archive it instead, or move the products first.`);
  await Supplier.deleteOne({ _id: req.params.id });
  res.json({ message: 'Supplier deleted' });
});
