const mongoose = require('mongoose');

// A buyer's rating of a seller. Only possible after a delivered order, and once per order, so reviews can't be faked.
const reviewSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    buyerName: String,
    itemTitle: String,
    rating: { type: Number, min: 1, max: 5, required: true },
    // the seller's service, star by star (optional): item as described, communication, delivery / handover
    aspects: { described: { type: Number, min: 1, max: 5 }, communication: { type: Number, min: 1, max: 5 }, delivery: { type: Number, min: 1, max: 5 } },
    comment: { type: String, trim: true, maxlength: 500, default: '' },
    reply: { type: String, trim: true, maxlength: 500, default: '' }, // the seller's public answer
    repliedAt: Date,
  },
  { timestamps: true }
);
reviewSchema.index({ seller: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
