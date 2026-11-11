// Purchases from suppliers: order -> receive goods (stock up, cost updated) -> pay.
const mongoose = require('mongoose');
const Purchase = require('../models/Purchase');
const Supplier = require('../models/Supplier');
const Product = require('../models/Product');
const asyncHandler = require('../utils/asyncHandler');
const { httpError } = require('../utils/saleService');
const { invalidate } = require('../utils/cache');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isId = (v) => mongoose.isValidObjectId(v);

// Validate the product lines against the database (names/SKUs come from the products, not the browser)
async function buildItems(lines) {
  if (!Array.isArray(lines) || !lines.length) throw httpError('Add at least one product');
  if (lines.length > 300) throw httpError('At most 300 products per purchase');
  const ids = lines.map((l) => l.product);
  if (!ids.every(isId)) throw httpError('Invalid product in the list');
  const products = await Product.find({ _id: { $in: ids } }, 'name sku cost').lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const seen = new Set();
  return lines.map((l) => {
    const p = byId.get(String(l.product));
    if (!p) throw httpError('A product in the list no longer exists');
    if (seen.has(String(p._id))) throw httpError(`${p.name} is listed twice`);
    seen.add(String(p._id));
    const quantity = Number(l.quantity);
    const unitCost = l.unitCost === undefined || l.unitCost === '' ? p.cost || 0 : Number(l.unitCost);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) throw httpError(`Enter a whole quantity for ${p.name}`);
    if (!(unitCost >= 0) || unitCost > 10000000) throw httpError(`Enter a valid unit cost for ${p.name}`);
    return { product: p._id, name: p.name, sku: p.sku || '', quantity, unitCost: r2(unitCost), received: 0 };
  });
}

// GET /api/purchases?status=&supplier=&payment=&q=&from=&to=&page=
exports.list = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const filter = {};
  const { status, supplier, payment, q, from, to } = req.query;
  if (status === 'open') filter.status = { $in: ['ordered', 'partial'] };
  else if (status) filter.status = status;
  if (supplier && isId(supplier)) filter.supplier = supplier;
  if (payment === 'owed') filter.paymentStatus = { $in: ['unpaid', 'partial'] };
  if (q) {
    const rx = new RegExp(escapeRegex(String(q).slice(0, 60)), 'i');
    filter.$or = [{ purchaseNo: rx }, { supplierName: rx }, { 'items.name': rx }, { 'deliveries.invoiceNo': rx }];
  }
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(`${from}T00:00:00`);
    if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59.999`);
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [purchases, count, owedAgg, monthAgg, awaiting] = await Promise.all([
    Purchase.find(filter, '-payments -deliveries').sort('-createdAt').skip((page - 1) * limit).limit(limit).lean(),
    Purchase.countDocuments(filter),
    // what you owe suppliers: value of goods received minus what you've paid
    Purchase.aggregate([
      { $match: { status: { $ne: 'cancelled' } } },
      { $group: { _id: null, owed: { $sum: { $max: [{ $subtract: ['$receivedValue', '$amountPaid'] }, 0] } } } },
    ]),
    Purchase.aggregate([
      { $match: { status: { $ne: 'cancelled' }, createdAt: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: '$total' }, n: { $sum: 1 } } },
    ]),
    Purchase.countDocuments({ status: { $in: ['ordered', 'partial'] } }),
  ]);
  res.json({
    purchases,
    count,
    page,
    pages: Math.ceil(count / limit) || 1,
    summary: { owed: r2(owedAgg[0]?.owed), monthTotal: r2(monthAgg[0]?.total), monthCount: monthAgg[0]?.n || 0, awaiting },
  });
});

exports.get = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Purchase not found', 404);
  const p = await Purchase.findById(req.params.id).lean();
  if (!p) throw httpError('Purchase not found', 404);
  // current stock next to each line, to help when receiving
  const stock = new Map((await Product.find({ _id: { $in: p.items.map((i) => i.product) } }, 'stock cost').lean()).map((x) => [String(x._id), x]));
  p.items = p.items.map((i) => ({ ...i, currentStock: stock.get(String(i.product))?.stock ?? null, currentCost: stock.get(String(i.product))?.cost ?? null }));
  res.json(p);
});

// GET /api/purchases/suggest?supplier=: pre-fill a new purchase from that supplier's low / out-of-stock products
exports.suggest = asyncHandler(async (req, res) => {
  if (!isId(req.query.supplier)) throw httpError('Choose a supplier');
  const products = await Product.find({ supplier: req.query.supplier, active: true }, 'name sku stock cost lowStockThreshold').lean();
  const items = products
    .filter((p) => p.stock <= (p.lowStockThreshold ?? 5))
    .sort((a, b) => a.stock - b.stock)
    .map((p) => {
      const t = p.lowStockThreshold ?? 5;
      return { product: p._id, name: p.name, sku: p.sku || '', stock: p.stock, quantity: Math.max(10, t * 3) - Math.max(0, p.stock), unitCost: p.cost || 0 };
    });
  res.json(items);
});

// POST /api/purchases { supplier, items:[{product, quantity, unitCost}], expectedDate, notes, status: 'draft'|'ordered' }
exports.create = asyncHandler(async (req, res) => {
  if (!isId(req.body.supplier)) throw httpError('Choose a supplier');
  const supplier = await Supplier.findById(req.body.supplier, 'name active').lean();
  if (!supplier) throw httpError('Supplier not found');
  const status = req.body.status === 'ordered' ? 'ordered' : 'draft';
  const p = await Purchase.create({
    supplier: supplier._id,
    supplierName: supplier.name,
    status,
    items: await buildItems(req.body.items),
    expectedDate: req.body.expectedDate ? new Date(req.body.expectedDate) : undefined,
    orderedAt: status === 'ordered' ? new Date() : undefined,
    notes: req.body.notes,
    createdBy: req.user.name,
  });
  res.status(201).json(p);
});

// PUT /api/purchases/:id: edit while it's a draft or ordered and nothing has arrived yet
exports.update = asyncHandler(async (req, res) => {
  const p = await Purchase.findById(req.params.id);
  if (!p) throw httpError('Purchase not found', 404);
  if (!['draft', 'ordered'].includes(p.status) || p.deliveries.length) throw httpError('Only purchases that haven’t been received can be edited');
  if (req.body.items) p.items = await buildItems(req.body.items);
  if (req.body.expectedDate !== undefined) p.expectedDate = req.body.expectedDate ? new Date(req.body.expectedDate) : undefined;
  if (req.body.notes !== undefined) p.notes = req.body.notes;
  if (req.body.status === 'ordered' && p.status === 'draft') {
    p.status = 'ordered';
    p.orderedAt = new Date();
  }
  await p.save();
  res.json(p);
});

// POST /api/purchases/:id/receive { lines:[{product, quantity, unitCost?}], invoiceNo }
// Adds the received quantities to stock and updates each product's cost to the weighted average
// of the stock already on the shelf and the new delivery.
exports.receive = asyncHandler(async (req, res) => {
  const p = await Purchase.findById(req.params.id);
  if (!p) throw httpError('Purchase not found', 404);
  if (!['draft', 'ordered', 'partial'].includes(p.status)) throw httpError(`This purchase is already ${p.status}`);
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  const received = [];
  for (const l of lines) {
    const qty = Number(l.quantity);
    if (!qty) continue;
    const item = p.items.find((i) => String(i.product) === String(l.product));
    if (!item) throw httpError('A received product is not on this purchase');
    if (!Number.isInteger(qty) || qty < 0) throw httpError(`Enter a whole number received for ${item.name}`);
    if (item.received + qty > item.quantity) throw httpError(`${item.name}: only ${item.quantity - item.received} still expected`);
    const unitCost = l.unitCost === undefined || l.unitCost === '' ? item.unitCost : r2(l.unitCost);
    if (!(unitCost >= 0)) throw httpError(`Enter a valid cost for ${item.name}`);
    item.unitCost = unitCost; // the invoice price may differ from the order
    item.received += qty;
    received.push({ product: item.product, name: item.name, quantity: qty, unitCost });
  }
  if (!received.length) throw httpError('Enter at least one quantity received');

  p.deliveries.push({ by: req.user.name, invoiceNo: String(req.body.invoiceNo || '').slice(0, 40), lines: received });
  const complete = p.items.every((i) => i.received >= i.quantity);
  p.status = complete ? 'received' : 'partial';
  if (!p.orderedAt) p.orderedAt = new Date();
  if (complete) p.receivedAt = new Date();
  try {
    await p.save(); // optimistic concurrency: fails if someone else changed this purchase meanwhile
  } catch (err) {
    if (err.name === 'VersionError') throw httpError('This purchase was just updated by someone else. Reload and try again.', 409);
    throw err;
  }

  // Stock up + weighted-average cost, done inside the database in one round trip
  await Product.bulkWrite(
    received.map((l) => ({
      updateOne: {
        filter: { _id: l.product },
        update: [
          {
            $set: {
              cost: {
                $round: [
                  {
                    $cond: [
                      { $gt: ['$stock', 0] },
                      { $divide: [{ $add: [{ $multiply: ['$stock', { $ifNull: ['$cost', 0] }] }, l.quantity * l.unitCost] }, { $add: ['$stock', l.quantity] }] },
                      l.unitCost,
                    ],
                  },
                  2,
                ],
              },
              stock: { $add: ['$stock', l.quantity] },
            },
          },
        ],
      },
    }))
  );
  invalidate('catalog'); // the online shop shows the new stock straight away
  res.json(await Purchase.findById(p._id).lean());
});

// POST /api/purchases/:id/payments { amount, method, reference }
exports.addPayment = asyncHandler(async (req, res) => {
  const p = await Purchase.findById(req.params.id);
  if (!p) throw httpError('Purchase not found', 404);
  if (p.status === 'cancelled') throw httpError('This purchase was cancelled');
  const amount = r2(req.body.amount);
  if (!(amount > 0)) throw httpError('Enter the amount paid');
  const owedOn = p.receivedValue > 0 ? p.receivedValue : p.total;
  if (p.amountPaid + amount > owedOn + 0.005) throw httpError(`That's more than the KSh ${r2(owedOn - p.amountPaid).toLocaleString()} still owed`);
  const method = ['cash', 'mpesa', 'bank', 'cheque', 'other'].includes(req.body.method) ? req.body.method : 'cash';
  p.payments.push({ amount, method, reference: String(req.body.reference || '').slice(0, 60), by: req.user.name });
  try {
    await p.save();
  } catch (err) {
    if (err.name === 'VersionError') throw httpError('This purchase was just updated by someone else. Reload and try again.', 409);
    throw err;
  }
  res.json(await Purchase.findById(p._id).lean());
});

// POST /api/purchases/:id/cancel: only before any goods have arrived
exports.cancel = asyncHandler(async (req, res) => {
  const p = await Purchase.findOneAndUpdate(
    { _id: req.params.id, status: { $in: ['draft', 'ordered'] }, 'deliveries.0': { $exists: false } },
    { $set: { status: 'cancelled' }, $inc: { __v: 1 } },
    { returnDocument: 'after' }
  ).lean();
  if (!p) throw httpError('Only purchases with nothing received yet can be cancelled');
  res.json(p);
});
