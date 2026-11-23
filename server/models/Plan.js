const mongoose = require('mongoose');

// Lipa Pole Pole (lay-away): pay a deposit with M-Pesa, then the rest in weekly instalments.
// The item is reserved once the deposit is paid and ships when everything is paid (it then becomes a normal order).
const paymentSchema = new mongoose.Schema(
  {
    amount: Number,
    status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
    checkoutRequestId: { type: String, index: true },
    receipt: String,
    phone: String,
    failReason: String,
    at: { type: Date, default: Date.now },
    paidAt: Date,
  },
  { _id: true }
);

const planSchema = new mongoose.Schema(
  {
    planNo: { type: String, unique: true },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
    title: String,
    slug: String,
    image: String,
    category: String,
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    buyerName: String,
    buyerPhone: String,
    buyerEmail: String,
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    sellerName: String,
    price: Number, // item price (or the agreed offer price)
    deliveryFee: { type: Number, default: 0 },
    total: Number,
    deposit: Number,
    weeks: Number,
    weekly: Number, // suggested weekly instalment
    paid: { type: Number, default: 0 },
    delivery: { method: String, county: String, address: String, notes: String, pickupArea: String },
    // pending_deposit → active (item reserved) → completed (order created) · cancelled · defaulted
    status: { type: String, enum: ['pending_deposit', 'active', 'completed', 'cancelled', 'defaulted'], default: 'pending_deposit', index: true },
    payments: [paymentSchema],
    reserved: { type: Boolean, default: false },
    dueBy: Date, // final date to finish paying
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    refundDue: { type: Number, default: 0 },
    refundStatus: { type: String, enum: ['none', 'due', 'refunded'], default: 'none' },
    cancelReason: String,
  },
  { timestamps: true }
);
planSchema.index({ buyer: 1, createdAt: -1 });
planSchema.index({ seller: 1, createdAt: -1 });
planSchema.index({ listing: 1, status: 1 }); // sold-ad cleanup: is a Lipa Pole Pole plan still running?

module.exports = mongoose.model('Plan', planSchema);
