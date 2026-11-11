const mongoose = require('mongoose');
const { tenantModel } = require('../tenancy/context');

// A private chat between a buyer and a seller about one ad
const conversationSchema = new mongoose.Schema(
  {
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
    // snapshot of the ad, so the chat still makes sense if the ad is later edited or deleted
    listingTitle: String,
    listingSlug: String,
    listingImage: String,
    listingPrice: Number,
    listingCategory: String,
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    buyerName: String,
    sellerName: String,
    lastMessage: { text: String, from: mongoose.Schema.Types.ObjectId, at: Date },
    unreadBuyer: { type: Number, default: 0 },
    unreadSeller: { type: Number, default: 0 },
  },
  { timestamps: true }
);

conversationSchema.index({ listing: 1, buyer: 1 }, { unique: true });
conversationSchema.index({ buyer: 1, updatedAt: -1 });
conversationSchema.index({ seller: 1, updatedAt: -1 });

module.exports = tenantModel('Conversation', conversationSchema);
