const mongoose = require('mongoose');
const { pointSchema } = require('../market/geo');

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
    // a price drop (market/discount.js): the old price, how much off, and until when it's shown as a deal
    wasPrice: { type: Number, default: null },
    discountPercent: { type: Number, default: 0 },
    discountUntil: { type: Date, default: null },
    condition: { type: String, default: '' },
    county: { type: String, required: true },
    area: { type: String, trim: true, maxlength: 60, default: '' },
    images: { type: [String], default: [] },
    // a free stock photo (Wikimedia Commons / Unsplash) for a demo ad without its own photo: who took it, its licence
    photoCredit: { _id: false, source: String, name: String, license: String, licenseUrl: String, profile: String, link: String, photoId: String, term: String },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' }, // the seller's store / branch it's sold from (market/stores.js)
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, // the catalogue product: other sellers' offers of it (market/catalog.js)
    sellerName: { type: String, default: '' },
    showPhone: { type: Boolean, default: true },
    // Jumia-style selling: buyers can order and pay online (M-Pesa or cash on delivery) instead of only chatting
    buyNow: { type: Boolean, default: false },
    stock: { type: Number, min: 0, default: 0 }, // units available to order online
    weightKg: { type: Number, min: 0 }, // about how heavy one item is (for delivery prices)
    soldCount: { type: Number, default: 0 },
    geo: { type: pointSchema, default: undefined }, // the seller's shop pin (when they show it), for "near me"
    origin: { type: String, default: '' }, // china, ex-uk, europe, usa, japan, dubai, local (market/origins.js)
    sellerVerified: { type: Boolean, default: false }, // copied from the seller, so cards can show the badge cheaply
    boostedUntil: { type: Date, default: null }, // "Featured" (paid boost) until this time
    // Lipa Pole Pole: buyers may pay a deposit and the rest weekly
    layaway: { enabled: { type: Boolean, default: false }, minDepositPercent: { type: Number, default: 30 }, maxWeeks: { type: Number, default: 4 } },
    // wholesale / bulk prices ("bei ya jumla"): see market/wholesale.js
    wholesale: {
      enabled: { type: Boolean, default: false },
      unit: { type: String, default: '' }, // carton, bale, crate, dozen, piece…
      retail: { type: Boolean, default: true }, // also sells single units at the normal price
      tiers: [{ _id: false, minQty: Number, price: Number }],
    },
    delivery: {
      available: { type: Boolean, default: true }, // seller delivers
      fee: { type: Number, min: 0, default: 0 }, // 0 = free delivery
      pickup: { type: Boolean, default: true }, // buyer can collect from the seller's area
      days: { type: String, trim: true, maxlength: 40, default: '' }, // e.g. "1-2 days"
    },
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

listingSchema.index({ geo: '2dsphere' }, { sparse: true });
listingSchema.index({ status: 1, createdAt: -1 });
listingSchema.index({ status: 1, category: 1, sub: 1, createdAt: -1 });
listingSchema.index({ status: 1, category: 1, price: 1 });
listingSchema.index({ keywords: 1, status: 1 });
listingSchema.index({ seller: 1, status: 1, createdAt: -1 });
listingSchema.index({ seller: 1, createdAt: -1 }); // My ads: every ad of mine, newest first (no sorting in memory)
listingSchema.index({ status: 1, county: 1 });
listingSchema.index({ reportCount: -1 });
listingSchema.index({ status: 1, buyNow: 1, createdAt: -1 });
listingSchema.index({ status: 1, discountPercent: -1, discountUntil: 1 }); // home page: best discounts
listingSchema.index({ status: 1, boostedUntil: -1, createdAt: -1 });
// category / sub-category / county pages sorted "featured first, then newest" (the default sort): no in-memory sort
listingSchema.index({ status: 1, category: 1, sub: 1, boostedUntil: -1, createdAt: -1 });
listingSchema.index({ status: 1, category: 1, boostedUntil: -1, createdAt: -1 });
listingSchema.index({ status: 1, county: 1, boostedUntil: -1, createdAt: -1 });
listingSchema.index({ status: 1, updatedAt: -1 }); // sitemap
listingSchema.index({ status: 1, 'wholesale.enabled': 1, createdAt: -1 });
listingSchema.index({ status: 1, origin: 1, createdAt: -1 });
listingSchema.index({ category: 1, sub: 1, 'attrs.make': 1, 'attrs.model': 1 });
// sorting: "most viewed" (home page, "popular") and "cheapest / dearest" across all categories
listingSchema.index({ status: 1, views: -1 });
listingSchema.index({ status: 1, price: 1 });
// wholesalers by trade and importers by what they import (/wholesale?trade=…, /imports?trade=…)
listingSchema.index({ status: 1, 'wholesale.enabled': 1, category: 1, createdAt: -1 });
listingSchema.index({ status: 1, origin: 1, category: 1, createdAt: -1 });
// a seller's ads by category (near-me pages group them per seller and category)
listingSchema.index({ seller: 1, status: 1, category: 1 });
// a store's ads (Seller hub → Inventory), and every seller's offer of one product, cheapest first
listingSchema.index({ store: 1, status: 1 }, { sparse: true });
listingSchema.index({ product: 1, status: 1, price: 1 }, { sparse: true });
// admin dashboard: new ads this week
listingSchema.index({ createdAt: -1 });
// colour swatches on search pages: only ads that have a colour
listingSchema.index({ status: 1, 'attrs.colour': 1 });

module.exports = mongoose.model('Listing', listingSchema);
