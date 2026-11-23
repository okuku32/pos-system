const mongoose = require('mongoose');

// "Make an offer": a buyer proposes a price, the seller accepts, declines or counters (Kenyan bargaining, in the app).
// An accepted offer on a "Buy online" ad becomes that buyer's price at checkout (valid 48 hours, used once).
const offerSchema = new mongoose.Schema(
  {
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    listingPrice: Number, // the asking price when the offer was made
    amount: { type: Number, required: true }, // current proposal (per item)
    qty: { type: Number, default: 1, min: 1 },
    // pending: waiting for the seller · countered: waiting for the buyer · accepted · declined · withdrawn · used (bought) · expired
    status: { type: String, enum: ['pending', 'countered', 'accepted', 'declined', 'withdrawn', 'used', 'expired'], default: 'pending' },
    history: [{ by: String, action: String, amount: Number, at: { type: Date, default: Date.now } }],
    acceptedAt: Date,
    // for ads not sold online: how the seller agreed to hand it over (set when the seller agrees a price in the chat)
    delivery: { available: { type: Boolean, default: false }, fee: { type: Number, default: 0 }, pickup: { type: Boolean, default: true } },
    expiresAt: Date, // accepted offers can be used until then
  },
  { timestamps: true }
);
offerSchema.index({ listing: 1, buyer: 1, status: 1 });

module.exports = mongoose.model('Offer', offerSchema);
