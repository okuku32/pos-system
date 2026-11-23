const mongoose = require('mongoose');

// A paid promotion. kind 'ad': one ad shows as "Featured" first in search and on the home page for some days.
// kind 'business' (sellers in our markets): every ad of theirs is featured for the month, and their shop shows first.
const boostSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['ad', 'business'], default: 'ad' },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' }, // an 'ad' boost
    listingTitle: String,
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    plan: { type: String, required: true }, // key from BOOST_PLANS
    days: Number,
    amount: Number,
    status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
    phone: String,
    checkoutRequestId: { type: String, index: true },
    receipt: String,
    failReason: String,
    paidAt: Date, // when the M-Pesa payment came in (earnings by day / week / month)
    startsAt: Date,
    endsAt: Date,
  },
  { timestamps: true }
);
boostSchema.index({ seller: 1, createdAt: -1 });
boostSchema.index({ status: 1, createdAt: -1 });
boostSchema.index({ status: 1, paidAt: -1 }); // Admin → Promotions
boostSchema.index({ status: 1, endsAt: 1 });

module.exports = mongoose.model('Boost', boostSchema);
