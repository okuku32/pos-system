const Order = require('../models/Order');
const asyncHandler = require('../utils/asyncHandler');
const { buildItems, computeTotals } = require('../utils/saleService');
const { emitOrder } = require('../utils/realtime');
const notify = require('../utils/notify');

const TYPES = ['walk-in', 'pickup', 'delivery'];
const STAGES = ['new', 'accepted', 'preparing', 'ready', 'out-for-delivery'];
// Orders store selling prices only — strip cost snapshots that buildItems adds
const stripCost = (items) => items.map(({ cost, ...rest }) => rest); // eslint-disable-line no-unused-vars

const populate = (q) => q.populate('createdBy', 'name').populate('sale', 'receiptNo paymentMethod total');

// GET /api/orders?status=open&q=...
exports.list = asyncHandler(async (req, res) => {
  const { status, q, source } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (source) filter.source = source;
  if (q) {
    const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ orderNo: rx }, { 'customer.name': rx }, { 'customer.phone': rx }];
  }
  const [orders, counts] = await Promise.all([
    populate(Order.find(filter).sort('-createdAt').limit(200)),
    Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);
  const unseen = await Order.countDocuments({ source: 'online', status: 'open', stage: 'new' });
  res.json({ orders, counts: Object.fromEntries(counts.map((c) => [c._id, c.count])), newOnline: unseen });
});

exports.get = asyncHandler(async (req, res) => {
  const order = await populate(Order.findById(req.params.id));
  if (!order) return res.status(404).json({ message: 'Order not found' });
  res.json(order);
});

// POST /api/orders { cart:[{productId,quantity}], customer:{name,phone}, type, discount, notes }
exports.create = asyncHandler(async (req, res) => {
  const { cart, customer = {}, type, discount, notes } = req.body;
  const items = stripCost(await buildItems(cart));
  const { subtotal, discount: disc, savings } = computeTotals(items, discount);
  const order = await Order.create({
    items,
    subtotal,
    discount: disc,
    savings,
    total: +(subtotal - disc).toFixed(2),
    customer: { name: customer.name, phone: customer.phone },
    type: TYPES.includes(type) ? type : 'walk-in',
    notes,
    createdBy: req.user._id,
    stage: 'accepted',
  });
  const full = await populate(Order.findById(order._id));
  emitOrder('order:new', full);
  res.status(201).json(full);
});

// PUT /api/orders/:id — edit an open order (items, customer, notes)
exports.update = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (order.status !== 'open') return res.status(400).json({ message: `Cannot edit a ${order.status} order` });
  const { cart, customer, type, discount, notes } = req.body;
  if (cart) {
    order.items = stripCost(await buildItems(cart));
  }
  if (cart || discount !== undefined) {
    const { subtotal, discount: disc } = computeTotals(order.items, discount ?? order.discount);
    Object.assign(order, { subtotal, discount: disc, total: +(subtotal - disc).toFixed(2) });
  }
  if (customer) {
    order.customer = {
      name: customer.name,
      phone: customer.phone,
      address: customer.address !== undefined ? customer.address : order.customer?.address,
    };
  }
  if (type && TYPES.includes(type)) order.type = type;
  if (notes !== undefined) order.notes = notes;
  await order.save();
  const full = await populate(Order.findById(order._id));
  emitOrder('order:updated', full);
  res.json(full);
});

// PATCH /api/orders/:id/stage { stage } — move an open order along (customer sees it live)
exports.setStage = asyncHandler(async (req, res) => {
  const { stage, etaMinutes } = req.body;
  if (!STAGES.includes(stage)) return res.status(400).json({ message: 'Invalid stage' });
  const set = { stage };
  const mins = Number(etaMinutes);
  if (Number.isFinite(mins) && mins > 0 && mins <= 24 * 60) set.eta = new Date(Date.now() + mins * 60000);
  const order = await Order.findOneAndUpdate(
    { _id: req.params.id, status: 'open' },
    { $set: set, $push: { stageHistory: { stage, at: new Date() } } },
    { returnDocument: 'after' }
  );
  if (!order) return res.status(400).json({ message: 'Only open orders can be updated' });
  const full = await populate(Order.findById(order._id));
  emitOrder('order:updated', full);
  notify.stageChanged(full); // "on the way" / "ready for pickup" email
  res.json(full);
});

exports.cancel = asyncHandler(async (req, res) => {
  const order = await Order.findOneAndUpdate(
    { _id: req.params.id, status: 'open' },
    { $set: { status: 'cancelled' }, $push: { stageHistory: { stage: 'cancelled', at: new Date() } } },
    { returnDocument: 'after' }
  );
  if (!order) return res.status(400).json({ message: 'Only open orders can be cancelled' });
  emitOrder('order:updated', order);
  notify.cancelled(order._id);
  res.json(order);
});

exports.remove = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (order.status === 'completed') return res.status(400).json({ message: 'Completed orders are kept for records' });
  await order.deleteOne();
  res.json({ message: 'Order deleted' });
});
