const mongoose = require('mongoose');

// "Rate Kapu": a buyer's or seller's public review of how WE served them (not of a seller).
// One per account (they can update it). Only people who have actually used the platform can post one
// (an order, a sale, an ad or an errand), and negative reviews are never hidden for being negative:
// staff hide a review only for abuse, spam or personal details, and that is logged.
const platformReviewSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, unique: true },
    name: { type: String, required: true }, // shown publicly as "Akinyi O."
    role: { type: String, enum: ['buyer', 'seller', 'both'], required: true }, // worked out from what they did on the platform
    verified: { type: Boolean, default: false }, // they completed an order (as buyer or seller)
    rating: { type: Number, min: 1, max: 5, required: true },
    topic: { type: String, enum: ['buying', 'selling', 'delivery', 'payments', 'support', 'other'], default: 'other' },
    comment: { type: String, trim: true, minlength: 10, maxlength: 800, required: true },
    reply: { type: String, trim: true, maxlength: 800, default: '' }, // the Kapu team's public answer
    repliedAt: Date,
    status: { type: String, enum: ['visible', 'hidden'], default: 'visible', index: true },
    hiddenReason: { type: String, default: '' },
    editedAt: Date,
  },
  { timestamps: true }
);
platformReviewSchema.index({ status: 1, createdAt: -1 });
platformReviewSchema.index({ status: 1, role: 1, createdAt: -1 });

module.exports = mongoose.model('PlatformReview', platformReviewSchema);
