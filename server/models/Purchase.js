const mongoose = require('mongoose');
const { tenantModel } = require('../tenancy/context');

// A purchase (order) from a supplier: draft -> ordered -> partially received -> received.
// Receiving goods adds to stock; payments track what is still owed to the supplier.
const itemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: String, // snapshot, so old purchases still read correctly if the product is renamed
    sku: String,
    quantity: { type: Number, required: true, min: 1 }, // ordered
    received: { type: Number, default: 0, min: 0 },
    unitCost: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0.01 },
    method: { type: String, enum: ['cash', 'mpesa', 'bank', 'cheque', 'other'], default: 'cash' },
    reference: { type: String, trim: true, maxlength: 60 },
    at: { type: Date, default: Date.now },
    by: String,
  },
  { _id: true }
);

const deliverySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    by: String,
    invoiceNo: String, // supplier's invoice / delivery note number
    lines: [{ _id: false, product: mongoose.Schema.Types.ObjectId, name: String, quantity: Number, unitCost: Number }],
  },
  { _id: true }
);

const purchaseSchema = new mongoose.Schema(
  {
    purchaseNo: { type: String, unique: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    supplierName: String,
    status: { type: String, enum: ['draft', 'ordered', 'partial', 'received', 'cancelled'], default: 'draft', index: true },
    items: { type: [itemSchema], validate: [(v) => v.length > 0, 'Add at least one product'] },
    total: { type: Number, default: 0 }, // value of everything ordered
    receivedValue: { type: Number, default: 0 }, // value of what has actually arrived (what you owe for)
    amountPaid: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid', index: true },
    expectedDate: Date,
    orderedAt: Date,
    receivedAt: Date,
    notes: { type: String, trim: true, maxlength: 1000 },
    payments: [paymentSchema],
    deliveries: [deliverySchema],
    createdBy: String,
  },
  { timestamps: true, optimisticConcurrency: true } // two people receiving the same order at once can't double-count stock
);

purchaseSchema.index({ createdAt: -1 });
purchaseSchema.index({ supplier: 1, createdAt: -1 });

purchaseSchema.pre('validate', function () {
  if (!this.purchaseNo) {
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    this.purchaseNo = `PO-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  this.total = r2(this.items.reduce((s, i) => s + i.quantity * i.unitCost, 0));
  this.receivedValue = r2(this.items.reduce((s, i) => s + i.received * i.unitCost, 0));
  this.amountPaid = r2(this.payments.reduce((s, p) => s + p.amount, 0));
  const owedOn = this.receivedValue > 0 ? this.receivedValue : this.total;
  this.paymentStatus = this.amountPaid <= 0 ? 'unpaid' : this.amountPaid + 0.005 >= owedOn ? 'paid' : 'partial';
});

// Lives in each client's own database (see tenancy/context.js)
module.exports = tenantModel('Purchase', purchaseSchema);
