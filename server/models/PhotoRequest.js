const mongoose = require('mongoose');

// "Can't find it? Send a photo": a buyer photographs something they want from a seller that isn't in the seller's
// ads (so it can't be added to the cart). The seller answers: "it's this ad", "I've posted it for you" (a new ad,
// made from the answer) or "sorry, I don't have it". Our team sees every request (Admin → Photo requests).
// The photos are private (server/private/requests): only the buyer, that seller and our team can open them.
const photoRequestSchema = new mongoose.Schema(
  {
    no: { type: String, unique: true }, // PR-XXXXXX
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    buyerName: String,
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    sellerName: String,
    what: { type: String, required: true, maxlength: 120 }, // what it is, in the buyer's words
    note: { type: String, maxlength: 500 }, // size, colour, brand…
    qty: { type: Number, default: 1, min: 1, max: 999 },
    budget: Number, // the most the buyer wants to pay (optional)
    photos: [{ _id: false, file: String, mime: String }],
    // open: waiting for the seller · answered: the seller linked an ad (the buyer can add it to the cart)
    // declined: the seller doesn't have it · cancelled: the buyer withdrew it
    status: { type: String, enum: ['open', 'answered', 'declined', 'cancelled'], default: 'open' },
    answer: {
      _id: false,
      listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
      listingTitle: String,
      listingSlug: String,
      price: Number,
      created: Boolean, // a new ad made for this request
      note: String,
      at: Date,
    },
    seenBySeller: { type: Boolean, default: false },
    seenByBuyer: { type: Boolean, default: true },
  },
  { timestamps: true }
);

photoRequestSchema.index({ buyer: 1, createdAt: -1 });
photoRequestSchema.index({ seller: 1, status: 1, createdAt: -1 });
photoRequestSchema.index({ status: 1, createdAt: -1 }); // our team's list

module.exports = mongoose.model('PhotoRequest', photoRequestSchema);
