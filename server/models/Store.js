const mongoose = require('mongoose');
const { pointSchema } = require('../market/geo');

// A seller's store or branch. One seller → many stores; one store → many listings (Listing.store);
// order items remember the store they ship from (Order.items.store) and each store's part of an order is
// its own delivery record (Delivery.store).
// The main store mirrors the seller's shop location (Customer.shopLocation, used by the "near me" pages);
// branches have their own pin, so their ads show up near the branch.
const storeSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameKey: { type: String, required: true }, // lower-case name: one "Gikomba branch" per seller
    area: { type: String, trim: true, maxlength: 60, default: '' },
    county: { type: String, trim: true, maxlength: 40, default: '' },
    address: { type: String, trim: true, maxlength: 200, default: '' },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    hours: { type: String, trim: true, maxlength: 80, default: '' }, // e.g. "Mon–Sat 8am–7pm"
    point: { type: pointSchema, default: undefined },
    public: { type: Boolean, default: true }, // the pin is shown to buyers
    isMain: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

storeSchema.index({ seller: 1, nameKey: 1 }, { unique: true }); // no two stores with the same name
storeSchema.index({ seller: 1 }, { unique: true, partialFilterExpression: { isMain: true }, name: 'one_main_store' }); // exactly one main store
storeSchema.index({ seller: 1, active: 1, isMain: -1 });
storeSchema.index({ point: '2dsphere' }, { sparse: true });

storeSchema.pre('validate', function () {
  this.nameKey = String(this.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
});

module.exports = mongoose.model('Store', storeSchema);
