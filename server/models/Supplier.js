const mongoose = require('mongoose');
const { tenantModel } = require('../tenancy/context');

// Who a shop buys its stock from. Products point to their supplier (Product.supplier).
const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    contactPerson: { type: String, trim: true, maxlength: 80 },
    phone: { type: String, trim: true, maxlength: 20 },
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
    kraPin: { type: String, trim: true, uppercase: true, maxlength: 11 },
    address: { type: String, trim: true, maxlength: 200 },
    paymentTerms: { type: String, trim: true, maxlength: 60 }, // e.g. "Cash on delivery", "Net 30"
    notes: { type: String, trim: true, maxlength: 1000 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Supplier names are unique per shop, ignoring capital letters ("Bidco" = "BIDCO")
supplierSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
supplierSchema.index({ active: 1, name: 1 });

// Lives in each client's own database (see tenancy/context.js)
module.exports = tenantModel('Supplier', supplierSchema);
