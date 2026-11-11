const mongoose = require('mongoose');
const { tenantModel } = require('../tenancy/context');

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, unique: true, sparse: true, trim: true },
    barcode: { type: String, trim: true, index: true },
    category: { type: String, default: 'General', trim: true },
    description: { type: String, trim: true, maxlength: 1000, default: '' }, // shown to customers in the shop
    price: { type: Number, required: true, min: 0 },
    cost: { type: Number, default: 0, min: 0 },
    stock: { type: Number, default: 0 },
    lowStockThreshold: { type: Number, default: 5 },
    active: { type: Boolean, default: true },
    image: { type: String, default: '' },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null }, // who you buy it from
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
// Fast lookups: shop/POS catalogue by category, supplier pages, low-stock checks
productSchema.index({ active: 1, category: 1, name: 1 });
productSchema.index({ supplier: 1, active: 1 });
productSchema.index({ active: 1, stock: 1 });

// Lives in each client's own database (see tenancy/context.js)
module.exports = tenantModel('Product', productSchema);
