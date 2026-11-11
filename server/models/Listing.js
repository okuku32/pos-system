const mongoose = require('mongoose');
const { tenantModel } = require('../tenancy/context');

// A marketplace ad posted by a customer (vehicle, land, phone, sofa...)
const listingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 5, maxlength: 90 },
    slug: { type: String, required: true, unique: true }, // used in the web address: /market/item/<slug>
    description: { type: String, trim: true, maxlength: 5000, default: '' },
    category: { type: String, required: true },
    sub: { type: String, required: true },
    attrs: { type: mongoose.Schema.Types.Mixed, default: {} }, // make, model, year, size... (see market/categories.js)
    price: { type: Number, min: 0, default: 0 }, // 0 = "Contact for price"
    negotiable: { type: Boolean, default: false },
    condition: { type: String, default: '' },
    county: { type: String, required: true },
    area: { type: String, trim: true, maxlength: 60, default: '' },
    images: { type: [String], default: [] },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    sellerName: { type: String, default: '' },
    showPhone: { type: Boolean, default: true },
    // active: visible · sold: kept for the seller, hidden from search · hidden: taken down by the shop's staff
    status: { type: String, enum: ['active', 'sold', 'hidden'], default: 'active' },
    hiddenReason: { type: String, default: '' },
    keywords: { type: [String], default: [] }, // search words (built by market/search.js)
    views: { type: Number, default: 0 },
    chats: { type: Number, default: 0 },
    reports: [{ by: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }, reason: String, at: { type: Date, default: Date.now } }],
    reportCount: { type: Number, default: 0 },
  },
  { timestamps: true, minimize: false }
);

listingSchema.index({ status: 1, createdAt: -1 });
listingSchema.index({ status: 1, category: 1, sub: 1, createdAt: -1 });
listingSchema.index({ status: 1, category: 1, price: 1 });
listingSchema.index({ keywords: 1, status: 1 });
listingSchema.index({ seller: 1, status: 1, createdAt: -1 });
listingSchema.index({ status: 1, county: 1 });
listingSchema.index({ reportCount: -1 });

module.exports = tenantModel('Listing', listingSchema);
