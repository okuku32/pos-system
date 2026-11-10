// Public customer-facing shop: browse products, place an order, track it. No login required.
const crypto = require('crypto');
const Product = require('../models/Product');
const Order = require('../models/Order');
const asyncHandler = require('../utils/asyncHandler');
const { buildItems, computeTotals, httpError } = require('../utils/saleService');
const { formatPhone } = require('../utils/mpesa');
const { emitOrder, ownerOrder } = require('../utils/realtime');
const notify = require('../utils/notify');
const { withPricing } = require('../utils/pricing');

const MAX_LINES = 50;
const MAX_QTY = 100;
const clean = (s, max) => String(s || '').replace(/[<>]/g, '').trim().slice(0, max);

// GET /api/shop/products — only what customers need (never cost price)
exports.products = asyncHandler(async (req, res) => {
  const products = await Product.find({ active: true, stock: { $gt: 0 } })
    .select('name category price discountPercent stock image')
    .sort('name');
  res.json(products.map(withPricing));
});

exports.categories = asyncHandler(async (req, res) => {
  res.json((await Product.distinct('category', { active: true, stock: { $gt: 0 } })).sort());
});

// POST /api/shop/orders { items:[{productId,quantity}], customer:{name,phone,address}, type:'pickup'|'delivery', notes }
exports.placeOrder = asyncHandler(async (req, res) => {
  const { items, customer = {}, type, notes } = req.body || {};
  if (!Array.isArray(items) || !items.length) throw httpError('Your cart is empty');
  if (items.length > MAX_LINES) throw httpError(`At most ${MAX_LINES} different items per order`);
  if (items.some((i) => Number(i.quantity) > MAX_QTY)) throw httpError(`At most ${MAX_QTY} of each item`);

  // Logged-in customer (protectCustomer): details default to their account
  const account = req.customer;
  const name = clean(customer.name || account.name, 60);
  if (name.length < 2) throw httpError('Please enter your name');
  let phone;
  try {
    phone = formatPhone(customer.phone || account.phone);
  } catch {
    throw httpError('Please enter a valid Safaricom/Kenyan mobile number, e.g. 0712 345 678');
  }
  const orderType = type === 'delivery' ? 'delivery' : 'pickup';
  const address = clean(customer.address, 200);
  if (orderType === 'delivery' && address.length < 5) throw httpError('Please enter a delivery address');

  // buildItems checks products exist, are active, and that there is enough stock
  const lines = (await buildItems(items.map((i) => ({ productId: i.productId, quantity: i.quantity })))).map(
    ({ cost, ...rest }) => rest // eslint-disable-line no-unused-vars
  );
  const { subtotal, savings } = computeTotals(lines, 0);

  const order = await Order.create({
    items: lines,
    subtotal,
    discount: 0,
    savings,
    total: subtotal,
    customer: { name, phone, address: orderType === 'delivery' ? address : undefined },
    type: orderType,
    notes: clean(notes, 300),
    source: 'online',
    stage: 'new',
    trackingToken: crypto.randomBytes(16).toString('hex'),
    customerAccount: account._id,
    stageHistory: [{ stage: 'new', at: new Date() }],
  });

  // Remember the delivery address (and the phone, for Google sign-ups) for next time
  let changed = false;
  if (orderType === 'delivery' && address !== account.address) {
    account.address = address;
    changed = true;
  }
  if (!account.phone && !(await require('../models/Customer').exists({ phone }))) {
    account.phone = phone;
    changed = true;
  }
  if (changed) await account.save();

  emitOrder('order:new', order); // staff get the real-time notification
  notify.orderPlaced(order._id); // customer gets a confirmation email
  res.status(201).json({ trackingToken: order.trackingToken, order: ownerOrder(order) });
});

// GET /api/shop/orders/:token — customer checks their order
exports.track = asyncHandler(async (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{32}$/.test(token)) return res.status(404).json({ message: 'Order not found' });
  const order = await Order.findOne({ trackingToken: token });
  if (!order) return res.status(404).json({ message: 'Order not found' });
  res.json(require('../utils/realtime').publicOrder(order));
});
