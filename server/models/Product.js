const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, unique: true, sparse: true, trim: true },
    barcode: { type: String, trim: true, index: true },
    category: { type: String, default: 'General', trim: true },
    price: { type: Number, required: true, min: 0 },
    cost: { type: Number, default: 0, min: 0 },
    stock: { type: Number, default: 0 },
    lowStockThreshold: { type: Number, default: 5 },
    active: { type: Boolean, default: true },
    image: { type: String, default: '' },
    discountPercent: { type: Number, default: 0, min: 0, max: 90 }, // promo discount, applied everywhere
    // KRA eTIMS: VAT category (A exempt, B 16%, C zero-rated, D non-VAT, E 8%) and item registration
    taxType: { type: String, enum: ['A', 'B', 'C', 'D', 'E'], default: 'B' },
    etimsClassCode: { type: String, trim: true }, // KRA item classification code (defaults to ETIMS_DEFAULT_ITEM_CLASS)
    etimsItemCode: { type: String, trim: true },
    etimsRegistered: { type: Boolean, default: false }, // public URL, e.g. /uploads/products/abc.jpg
  },
  { timestamps: true }
);

productSchema.index({ name: 'text', sku: 'text', barcode: 'text' });

module.exports = mongoose.model('Product', productSchema);
