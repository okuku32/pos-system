const mongoose = require('mongoose');

// A product in our catalogue (e.g. "Samsung Galaxy A15 128GB"). One product → many seller listings (Listing.product),
// so the same product can be sold by different sellers (and stores) at different prices; buyers compare them.
// key: what makes two ads the same product (market/catalog.js productKey) — unique, so there's never a duplicate.
// offers / minPrice / maxPrice / sellers are worked out from the live listings (catalog.refresh).
const productSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // unique: see the index below
    name: { type: String, required: true, trim: true, maxlength: 90 },
    category: { type: String, required: true },
    sub: { type: String, required: true },
    brand: { type: String, default: '' },
    model: { type: String, default: '' },
    image: { type: String, default: '' },
    imageCredit: { _id: false, source: String, name: String, license: String, licenseUrl: String, profile: String, link: String, photoId: String, term: String }, // a free stock photo (Wikimedia Commons / Unsplash): who took it, its licence
    offers: { type: Number, default: 0 }, // live listings
    sellers: { type: Number, default: 0 }, // different sellers
    minPrice: { type: Number, default: 0 },
    maxPrice: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// unique, but only for catalogue products (they always have a key). The same "products" collection still holds the
// earlier POS version's grocery products, which have no key: a plain unique index counts all of them as the same
// missing key (E11000 dup key { key: null }) and can't be built. Those old records are left untouched.
productSchema.index({ key: 1 }, { unique: true, partialFilterExpression: { key: { $exists: true } } }); // $exists: MongoDB uses it for findOne({ key })
productSchema.index({ category: 1, sub: 1, offers: -1 });
productSchema.index({ offers: -1, updatedAt: -1 });

module.exports = mongoose.model('Product', productSchema);
