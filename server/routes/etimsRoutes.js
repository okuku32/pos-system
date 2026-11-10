const r = require('express').Router();
const { protect, adminOnly } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const etims = require('../utils/etims');
const Sale = require('../models/Sale');

// GET /api/etims/status
r.get('/status', protect, adminOnly, asyncHandler(async (req, res) => res.json(await etims.status())));

// POST /api/etims/init: initialise the device with KRA (gets the communication key)
r.post('/init', protect, adminOnly, asyncHandler(async (req, res) => {
  try {
    res.json(await etims.initDevice());
  } catch (err) {
    res.status(502).json({ message: err.message });
  }
}));

// GET /api/etims/problems: sales KRA hasn't accepted yet
r.get('/problems', protect, adminOnly, asyncHandler(async (req, res) => {
  const sales = await Sale.find({ 'etims.status': { $in: ['pending', 'retrying', 'failed'] } })
    .select('receiptNo total createdAt etims paymentMethod')
    .sort('-createdAt')
    .limit(100);
  res.json(sales);
}));

// POST /api/etims/resend/:saleId: try a sale again now
r.post('/resend/:saleId', protect, adminOnly, asyncHandler(async (req, res) => {
  await Sale.updateOne({ _id: req.params.saleId, 'etims.status': { $ne: 'submitted' } }, { $set: { 'etims.status': 'pending' } });
  const result = await etims.submitSale(req.params.saleId);
  const sale = await Sale.findById(req.params.saleId).select('receiptNo etims');
  if (!sale) return res.status(404).json({ message: 'Sale not found' });
  res.status(result ? 200 : 502).json({ message: result ? 'Accepted by KRA' : `Not accepted: ${sale.etims?.error || 'unknown error'}`, etims: sale.etims });
}));

// POST /api/etims/retry-all: queue every unsubmitted sale for an immediate retry
r.post('/retry-all', protect, adminOnly, asyncHandler(async (req, res) => {
  const r2 = await Sale.updateMany(
    { status: 'completed', 'etims.status': { $in: ['retrying', 'failed', 'pending'] } },
    { $set: { 'etims.status': 'pending', 'etims.nextAttemptAt': new Date() } }
  );
  res.json({ message: `${r2.modifiedCount} sale(s) queued for retry` });
}));

module.exports = r;
