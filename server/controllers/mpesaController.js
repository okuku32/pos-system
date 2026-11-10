const Sale = require('../models/Sale');
const asyncHandler = require('../utils/asyncHandler');
const mpesa = require('../utils/mpesa');
const { applyMpesaResult } = require('../utils/saleService');

// Safaricom calls this URL (must be public HTTPS) after the customer responds to the STK prompt
exports.callback = async (req, res) => {
  try {
    const cb = req.body && req.body.Body && req.body.Body.stkCallback;
    if (cb) {
      const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || [];
      const meta = Object.fromEntries(items.map((i) => [i.Name, i.Value]));
      await applyMpesaResult(cb.CheckoutRequestID, {
        resultCode: cb.ResultCode,
        resultDesc: cb.ResultDesc,
        receiptNumber: meta.MpesaReceiptNumber,
        transactionDate: meta.TransactionDate,
        phone: meta.PhoneNumber,
      });
      console.log(`M-Pesa callback ${cb.CheckoutRequestID}: ${cb.ResultCode} ${cb.ResultDesc}`);
    }
  } catch (err) {
    console.error('M-Pesa callback error:', err);
  }
  // Always acknowledge so Safaricom stops retrying
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
};

// GET /api/mpesa/status/:saleId — the frontend polls this. If still pending, ask Daraja directly,
// which also works when the callback URL is unreachable (e.g. local dev without ngrok).
exports.status = asyncHandler(async (req, res) => {
  let sale = await Sale.findById(req.params.saleId).populate('cashier', 'name');
  if (!sale) return res.status(404).json({ message: 'Sale not found' });

  const ageSec = (Date.now() - sale.createdAt.getTime()) / 1000;
  if (sale.status === 'pending' && sale.mpesa && sale.mpesa.checkoutRequestId && ageSec > 10) {
    try {
      const q = await mpesa.stkQuery(sale.mpesa.checkoutRequestId);
      if (q.ResultCode !== undefined) {
        await applyMpesaResult(sale.mpesa.checkoutRequestId, { resultCode: q.ResultCode, resultDesc: q.ResultDesc });
        sale = await Sale.findById(sale._id).populate('cashier', 'name');
      }
    } catch (err) {
      // While the customer hasn't responded yet Daraja returns an error ("transaction is being processed")
      const data = err.response && err.response.data;
      if (!(data && data.errorCode === '500.001.1001')) console.warn('STK query:', data || err.message);
    }
  }
  res.json(sale);
});

// Cashier gives up waiting for a pending M-Pesa payment
exports.cancel = asyncHandler(async (req, res) => {
  const sale = await Sale.findOneAndUpdate(
    { _id: req.params.saleId, status: 'pending' },
    { $set: { status: 'cancelled', 'mpesa.resultDesc': 'Cancelled by cashier' } },
    { returnDocument: 'after' }
  );
  if (!sale) return res.status(400).json({ message: 'Sale is not pending' });
  res.json(sale);
});

// Admin: check that the Daraja credentials work
exports.testAuth = asyncHandler(async (req, res) => {
  try {
    await mpesa.getAccessToken();
    res.json({ ok: true, message: `Connected to Daraja (${process.env.MPESA_ENV || 'sandbox'})` });
  } catch (err) {
    const data = err.response && err.response.data;
    res.status(502).json({ ok: false, message: (data && data.errorMessage) || err.message });
  }
});
