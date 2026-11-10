const Product = require('../models/Product');
const Sale = require('../models/Sale');
const Order = require('../models/Order');
const { emitOrder } = require('./realtime');
const notify = require('./notify');
const { salePrice } = require('./pricing');

const httpError = (message, status = 400) => Object.assign(new Error(message), { status });

// Validate cart against DB and build line items with authoritative prices and cost snapshots
async function buildItems(cart) {
  if (!Array.isArray(cart) || cart.length === 0) throw httpError('Cart is empty');
  const ids = cart.map((c) => c.productId);
  const products = await Product.find({ _id: { $in: ids }, active: true });
  const map = new Map(products.map((p) => [String(p._id), p]));

  return cart.map((c) => {
    const p = map.get(String(c.productId));
    const qty = Number(c.quantity);
    if (!p) throw httpError('A product in the cart no longer exists');
    if (!Number.isInteger(qty) || qty < 1) throw httpError(`Invalid quantity for ${p.name}`);
    if (p.stock < qty) throw httpError(`Insufficient stock for ${p.name} (available: ${p.stock})`);
    const price = salePrice(p); // discounted price, decided on the server
    return {
      product: p._id,
      name: p.name,
      price,
      listPrice: p.price,
      cost: p.cost || 0,
      quantity: qty,
      subtotal: +(price * qty).toFixed(2),
    };
  });
}

function computeTotals(items, discount = 0, taxRate = 0) {
  const subtotal = +items.reduce((s, i) => s + i.subtotal, 0).toFixed(2);
  const disc = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const tax = +(((subtotal - disc) * (Number(taxRate) || 0)) / 100).toFixed(2);
  const total = +(subtotal - disc + tax).toFixed(2);
  const totalCost = +items.reduce((s, i) => s + (i.cost || 0) * i.quantity, 0).toFixed(2);
  const profit = +(subtotal - disc - totalCost).toFixed(2);
  // What the customer saved through product discounts (shown on receipts, cart and emails)
  const savings = +items.reduce((s, i) => s + Math.max(0, ((i.listPrice ?? i.price) - i.price) * i.quantity), 0).toFixed(2);
  return { subtotal, discount: disc, tax, total, totalCost, profit, savings };
}

async function deductStock(sale) {
  // Atomically flip the flag so stock is only ever deducted once
  const claimed = await Sale.findOneAndUpdate(
    { _id: sale._id, stockDeducted: false },
    { $set: { stockDeducted: true } },
    { returnDocument: 'after' }
  );
  if (!claimed) return;
  await Product.bulkWrite(
    sale.items.map((i) => ({ updateOne: { filter: { _id: i.product }, update: { $inc: { stock: -i.quantity } } } }))
  );
}

// Everything that happens once a sale is actually paid
async function finalizeSale(sale) {
  await deductStock(sale);
  require('./etims').queueSale(sale._id); // report the sale to KRA eTIMS (no-op when eTIMS is off)
  require('./realtime').emitStaff('sale:completed', { _id: sale._id, total: sale.total });
  if (sale.order) {
    const order = await Order.findOneAndUpdate(
      { _id: sale.order, status: 'open' },
      { $set: { status: 'completed', sale: sale._id, completedAt: new Date() }, $push: { stageHistory: { stage: 'completed', at: new Date() } } },
      { returnDocument: 'after' }
    );
    emitOrder('order:updated', order);
    if (order) notify.paymentReceived(order._id, sale); // payment confirmation email (online orders)
  }
}

// Apply an M-Pesa result (from callback or STK query) to a pending sale
async function applyMpesaResult(checkoutRequestId, { resultCode, resultDesc, receiptNumber, transactionDate, phone }) {
  const code = Number(resultCode);
  const update = {
    status: code === 0 ? 'completed' : code === 1032 ? 'cancelled' : 'failed',
    'mpesa.resultCode': code,
    'mpesa.resultDesc': resultDesc,
  };
  if (receiptNumber) update['mpesa.receiptNumber'] = receiptNumber;
  if (transactionDate) update['mpesa.transactionDate'] = String(transactionDate);
  if (phone) update['mpesa.phone'] = String(phone);

  const sale = await Sale.findOneAndUpdate(
    { 'mpesa.checkoutRequestId': checkoutRequestId, status: 'pending' },
    { $set: update },
    { returnDocument: 'after' }
  );
  if (sale && code === 0) await finalizeSale(sale);

  // The callback can arrive after an STK query already completed the sale; still record the receipt number
  if (!sale && receiptNumber) {
    await Sale.updateOne(
      { 'mpesa.checkoutRequestId': checkoutRequestId, 'mpesa.receiptNumber': { $exists: false } },
      { $set: { 'mpesa.receiptNumber': receiptNumber } }
    );
  }
  return sale || Sale.findOne({ 'mpesa.checkoutRequestId': checkoutRequestId });
}

// One-time fix-up for sales recorded before profit tracking existed:
// fill in item cost from the product's current cost price.
async function backfillSaleCosts() {
  const old = await Sale.find({ 'items.cost': { $exists: false } });
  if (!old.length) return;
  const ids = [...new Set(old.flatMap((s) => s.items.map((i) => String(i.product))))];
  const costs = new Map((await Product.find({ _id: { $in: ids } }, 'cost')).map((p) => [String(p._id), p.cost || 0]));
  for (const s of old) {
    s.items.forEach((i) => (i.cost = costs.get(String(i.product)) || 0));
    s.totalCost = +s.items.reduce((t, i) => t + i.cost * i.quantity, 0).toFixed(2);
    s.profit = +((s.subtotal || 0) - (s.discount || 0) - s.totalCost).toFixed(2);
    await s.save();
  }
  console.log(`Backfilled cost/profit on ${old.length} older sale(s)`);
}

module.exports = { buildItems, computeTotals, deductStock, finalizeSale, applyMpesaResult, backfillSaleCosts, httpError };
