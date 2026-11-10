const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const Order = require('../models/Order');
const Product = require('../models/Product');
const asyncHandler = require('../utils/asyncHandler');
const { buildItems, computeTotals, finalizeSale } = require('../utils/saleService');
const mpesa = require('../utils/mpesa');
const etims = require('../utils/etims');
const KRA_PIN = /^[AP]\d{9}[A-Z]$/i; // e.g. P051234567X

const TAX_RATE = Number(process.env.TAX_RATE || 0);
// Cashiers never see cost price or profit
const HIDDEN_FOR_CASHIER = '-items.cost -totalCost -profit';
const projection = (user) => (user.role === 'admin' ? '' : HIDDEN_FOR_CASHIER);

// POST /api/sales  { cart:[{productId,quantity}], paymentMethod:'cash'|'mpesa', discount, amountTendered, phone, orderId }
exports.create = asyncHandler(async (req, res) => {
  const { cart, paymentMethod, discount, amountTendered, phone, orderId } = req.body;
  const customerTin = String(req.body.customerTin || '').trim().toUpperCase();
  if (customerTin && !KRA_PIN.test(customerTin)) return res.status(400).json({ message: 'Customer KRA PIN should look like P051234567X' });

  let order = null;
  if (orderId) {
    order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'open') return res.status(400).json({ message: `Order is already ${order.status}` });
  }

  const items = await buildItems(cart);
  const totals = computeTotals(items, discount, TAX_RATE);
  const base = { items, ...totals, paymentMethod, cashier: req.user._id, order: order?._id, customerTin: customerTin || undefined, customerName: req.body.customerName ? String(req.body.customerName).slice(0, 60) : order?.customer?.name };

  if (paymentMethod === 'cash') {
    const tendered = Number(amountTendered);
    if (!(tendered >= totals.total)) return res.status(400).json({ message: 'Amount tendered is less than total' });
    const sale = await Sale.create({
      ...base,
      status: 'completed',
      amountTendered: tendered,
      change: +(tendered - totals.total).toFixed(2),
    });
    await finalizeSale(sale);
    await etims.submitWithTimeout(sale._id); // so the printed receipt can carry the KRA signature
    return res
      .status(201)
      .json({ sale: await Sale.findById(sale._id).select(projection(req.user)).populate('cashier', 'name').populate('order', 'orderNo') });
  }

  if (paymentMethod === 'mpesa') {
    if (!phone) return res.status(400).json({ message: 'Phone number is required for M-Pesa' });
    mpesa.formatPhone(phone); // throws 400 on invalid number before we create anything
    const sale = await Sale.create({ ...base, status: 'pending' });
    try {
      const r = await mpesa.stkPush({
        phone,
        amount: totals.total,
        accountReference: sale.receiptNo.slice(-12),
        description: 'POS Sale',
      });
      sale.mpesa = { phone: r.phone, merchantRequestId: r.MerchantRequestID, checkoutRequestId: r.CheckoutRequestID };
      await sale.save();
      return res.status(201).json({ sale: await Sale.findById(sale._id).select(projection(req.user)), message: r.CustomerMessage || 'STK push sent' });
    } catch (err) {
      const msg = err.response?.data?.errorMessage || err.message;
      sale.status = 'failed';
      sale.mpesa = { resultDesc: msg };
      await sale.save();
      return res.status(502).json({ message: `M-Pesa request failed: ${msg}` });
    }
  }

  res.status(400).json({ message: 'Invalid payment method' });
});

function buildFilter(query, user) {
  const { from, to, status, paymentMethod, cashier, q } = query;
  const filter = {};
  if (status) filter.status = status;
  if (paymentMethod) filter.paymentMethod = paymentMethod;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(`${from}T00:00:00`);
    if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59.999`);
  }
  if (user.role !== 'admin') filter.cashier = user._id;
  else if (cashier && mongoose.isValidObjectId(cashier)) filter.cashier = new mongoose.Types.ObjectId(cashier);
  if (q) {
    const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ receiptNo: rx }, { 'mpesa.receiptNumber': rx }, { 'mpesa.phone': rx }];
  }
  return filter;
}

exports.list = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(1000, Number(req.query.limit) || 50);
  const filter = buildFilter(req.query, req.user);

  const [sales, count, summaryAgg] = await Promise.all([
    Sale.find(filter)
      .select(projection(req.user))
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('cashier', 'name')
      .populate('order', 'orderNo'),
    Sale.countDocuments(filter),
    // Totals across ALL matching completed sales (not just this page)
    Sale.aggregate([
      { $match: { ...filter, status: 'completed' } },
      { $group: { _id: null, revenue: { $sum: '$total' }, profit: { $sum: '$profit' }, count: { $sum: 1 } } },
    ]),
  ]);

  const summary = summaryAgg[0] || { revenue: 0, profit: 0, count: 0 };
  delete summary._id;
  if (req.user.role !== 'admin') delete summary.profit;
  res.json({ sales, count, page, pages: Math.ceil(count / limit) || 1, summary });
});

exports.get = asyncHandler(async (req, res) => {
  const sale = await Sale.findById(req.params.id)
    .select(projection(req.user))
    .populate('cashier', 'name')
    .populate('order', 'orderNo');
  if (!sale) return res.status(404).json({ message: 'Sale not found' });
  res.json(sale);
});

// GET /api/sales/today: running totals for the checkout screen's Today bar
exports.today = asyncHandler(async (req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [all] = await Sale.aggregate([
    { $match: { status: 'completed', createdAt: { $gte: start } } },
    {
      $group: {
        _id: null,
        revenue: { $sum: '$total' },
        profit: { $sum: '$profit' },
        count: { $sum: 1 },
        savings: { $sum: { $add: [{ $ifNull: ['$savings', 0] }, { $ifNull: ['$discount', 0] }] } },
        items: { $sum: { $sum: '$items.quantity' } },
      },
    },
  ]);
  const t = all || { revenue: 0, profit: 0, count: 0, savings: 0, items: 0 };
  const out = { revenue: t.revenue, count: t.count, items: t.items, discounts: t.savings, avg: t.count ? t.revenue / t.count : 0 };
  if (req.user.role === 'admin') out.profit = t.profit; // cashiers never see profit
  res.json(out);
});

// Dashboard stats (admin)
exports.stats = asyncHandler(async (req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const weekAgo = new Date(startOfDay);
  weekAgo.setDate(weekAgo.getDate() - 6);
  const done = { status: 'completed' };

  const [today, byMethod, daily, topProducts, lowStock, productCount, openOrders] = await Promise.all([
    Sale.aggregate([
      { $match: { ...done, createdAt: { $gte: startOfDay } } },
      { $group: { _id: null, revenue: { $sum: '$total' }, profit: { $sum: '$profit' }, count: { $sum: 1 } } },
    ]),
    Sale.aggregate([
      { $match: { ...done, createdAt: { $gte: startOfDay } } },
      { $group: { _id: '$paymentMethod', revenue: { $sum: '$total' }, count: { $sum: 1 } } },
    ]),
    Sale.aggregate([
      { $match: { ...done, createdAt: { $gte: weekAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Africa/Nairobi' } },
          revenue: { $sum: '$total' },
          profit: { $sum: '$profit' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Sale.aggregate([
      { $match: { ...done, createdAt: { $gte: weekAgo } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.name', qty: { $sum: '$items.quantity' }, revenue: { $sum: '$items.subtotal' } } },
      { $sort: { qty: -1 } },
      { $limit: 5 },
    ]),
    Product.find({ active: true, $expr: { $lte: ['$stock', '$lowStockThreshold'] } }).sort('stock').limit(10),
    Product.countDocuments({ active: true }),
    Order.countDocuments({ status: 'open' }),
  ]);

  res.json({
    today: today[0] || { revenue: 0, profit: 0, count: 0 },
    byMethod,
    daily,
    topProducts,
    lowStock,
    productCount,
    openOrders,
  });
});
