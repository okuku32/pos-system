const mongoose = require('mongoose');

// A customer order: saved at the counter (held / pickup / delivery) and paid later.
// Paying an order creates a Sale linked back to it; the order is then 'completed'.
const itemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: String,
    price: Number,
    listPrice: Number,
    quantity: { type: Number, required: true, min: 1 },
    subtotal: Number,
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNo: { type: String, unique: true },
    customer: {
      name: { type: String, trim: true },
      phone: { type: String, trim: true },
      address: { type: String, trim: true }, // for delivery orders
    },
    // 'pos' = created at the counter, 'online' = placed by a customer on the shop page
    source: { type: String, enum: ['pos', 'online'], default: 'pos', index: true },
    // Progress of an open order, shown live to the customer
    stage: { type: String, enum: ['new', 'accepted', 'preparing', 'ready', 'out-for-delivery'], default: 'new' },
    // Random secret that lets a customer follow their own order without logging in
    trackingToken: { type: String, index: true, sparse: true },
    // Logged-in shop customer who placed the order
    customerAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', index: true },
    // Time-stamped progress, shown on the customer's tracking timeline
    stageHistory: [{ _id: false, stage: String, at: { type: Date, default: Date.now } }],
    // Estimated delivery/pickup time, set when staff send the order out
    eta: Date,
    // Which customer emails have gone out (each is sent once)
    emailsSent: {
      placed: Boolean,
      paid: Boolean,
      dispatched: Boolean,
      ready: Boolean,
      cancelled: Boolean,
    },
    type: { type: String, enum: ['walk-in', 'pickup', 'delivery'], default: 'walk-in' },
    items: [itemSchema],
    subtotal: Number,
    discount: { type: Number, default: 0 },
    savings: { type: Number, default: 0 }, // product discounts on this order
    total: Number,
    notes: { type: String, trim: true },
    status: { type: String, enum: ['open', 'completed', 'cancelled'], default: 'open', index: true },
    sale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    completedAt: Date,
  },
  { timestamps: true }
);

orderSchema.pre('save', function () {
  if (!this.orderNo) {
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    this.orderNo = `ORD-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }
});

module.exports = mongoose.model('Order', orderSchema);
