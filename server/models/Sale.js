const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: String,
    price: Number, // price actually charged (after product discount)
    listPrice: Number, // original price before the product discount
    cost: { type: Number, default: 0 }, // unit cost snapshot at time of sale (for profit)
    quantity: { type: Number, required: true, min: 1 },
    subtotal: Number,
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
    receiptNo: { type: String, unique: true },
    items: [itemSchema],
    subtotal: Number,
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, required: true },
    totalCost: { type: Number, default: 0 }, // sum of item cost × quantity
    savings: { type: Number, default: 0 }, // product discounts given on this sale
    profit: { type: Number, default: 0 }, // (subtotal - discount) - totalCost; tax is not profit
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    customerTin: { type: String, trim: true, uppercase: true }, // buyer's KRA PIN (optional, for business customers)
    customerName: { type: String, trim: true },
    // KRA eTIMS result: status pending | retrying | submitted | failed, receipt number, signature, QR link...
    etims: mongoose.Schema.Types.Mixed,
    paymentMethod: { type: String, enum: ['cash', 'mpesa'], required: true },
    // pending -> waiting for M-Pesa confirmation; completed -> paid; failed/cancelled
    status: { type: String, enum: ['pending', 'completed', 'failed', 'cancelled'], default: 'pending' },
    amountTendered: Number,
    change: Number,
    mpesa: {
      phone: String,
      merchantRequestId: String,
      checkoutRequestId: { type: String, index: true },
      receiptNumber: String,
      resultCode: Number,
      resultDesc: String,
      transactionDate: String,
    },
    stockDeducted: { type: Boolean, default: false },
    cashier: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

saleSchema.index({ status: 1, createdAt: -1 });

saleSchema.pre('save', function () {
  if (!this.receiptNo) {
    const d = new Date();
    const stamp = d.toISOString().slice(2, 10).replace(/-/g, '');
    this.receiptNo = `RCPT-${stamp}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  }
});

module.exports = mongoose.model('Sale', saleSchema);
