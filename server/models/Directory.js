const mongoose = require('mongoose');

// The people on Kapu, one table per kind. Everyone logs in with ONE account (Customer); these tables say
// what they are and keep their numbers ready for the admin. They're filled in from the accounts, ads, orders and
// jobs (market/directory.js) and kept up to date automatically: change the source, not these.
//   buyers · retailers · wholesalers · importers (a seller can be in more than one) · riders · shoppingagents
const ref = { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, unique: true };
const who = {
  customer: ref,
  name: String,
  email: String,
  phone: String,
  county: String,
  active: { type: Boolean, default: true },
  joinedAt: Date, // when the account was opened
};
const opts = { timestamps: true, versionKey: false };

// ---------------- buyers: everyone who orders (or signed up to buy)
const buyerSchema = new mongoose.Schema({
  ...who,
  orders: { type: Number, default: 0 }, // placed (paid or pay-on-delivery)
  delivered: { type: Number, default: 0 },
  cancelled: { type: Number, default: 0 },
  spent: { type: Number, default: 0 }, // KSh, delivered orders
  averageOrder: { type: Number, default: 0 },
  sellers: { type: Number, default: 0 }, // different sellers bought from
  firstOrderAt: Date,
  lastOrderAt: Date,
}, opts);
buyerSchema.index({ spent: -1 });
buyerSchema.index({ lastOrderAt: -1 });
buyerSchema.index({ county: 1, spent: -1 });

// ---------------- sellers (the same shape for retailers, wholesalers and importers)
const sellerFields = {
  ...who,
  shop: String, // shop name
  area: String,
  market: String, // market name, for market traders
  kinds: [String], // what they told us (shop, boutique, wholesaler, importer…)
  verified: Boolean,
  rating: Number,
  reviews: Number,
  ads: { type: Number, default: 0 }, // live ads (of this kind: retail / wholesale / imported)
  allAds: { type: Number, default: 0 }, // all their live ads
  categories: [String],
  sales: { type: Number, default: 0 }, // delivered orders
  revenue: { type: Number, default: 0 }, // KSh, delivered orders (items)
  lastSaleAt: Date,
  lastAdAt: Date,
};
const retailerSchema = new mongoose.Schema({ ...sellerFields }, opts);
const wholesalerSchema = new mongoose.Schema({ ...sellerFields, trades: [String], units: [String] }, opts); // trades: cereals, electronics, packaging…
const importerSchema = new mongoose.Schema({ ...sellerFields, trades: [String], origins: [String] }, opts); // what they import, and from where
for (const item of [retailerSchema, wholesalerSchema, importerSchema]) {
  item.index({ revenue: -1 });
  item.index({ ads: -1 });
  item.index({ county: 1, revenue: -1 });
}
wholesalerSchema.index({ trades: 1 });
importerSchema.index({ trades: 1 });
importerSchema.index({ origins: 1 });

// ---------------- riders & shopping agents
const workerFields = {
  ...who,
  status: String, // pending / approved / rejected / suspended
  available: Boolean,
  baseArea: String,
  market: String,
  radiusKm: Number,
  mpesaPhone: String,
  jobs: { type: Number, default: 0 }, // finished
  activeJobs: { type: Number, default: 0 },
  fees: { type: Number, default: 0 }, // agent fees (KSh)
  earned: { type: Number, default: 0 }, // after our commission & tax
  sent: { type: Number, default: 0 }, // paid to their M-Pesa
  balance: { type: Number, default: 0 }, // still to send (− they owe us)
  tips: { type: Number, default: 0 },
  lastJobAt: Date,
  appliedAt: Date,
  approvedAt: Date,
};
const riderSchema = new mongoose.Schema({ ...workerFields, vehicle: String, plate: String }, opts);
const agentSchema = new mongoose.Schema({ ...workerFields, inspections: { type: Number, default: 0 } }, opts);
for (const item of [riderSchema, agentSchema]) {
  item.index({ status: 1, jobs: -1 });
  item.index({ earned: -1 });
}

module.exports = {
  Buyer: mongoose.model('Buyer', buyerSchema, 'buyers'),
  Retailer: mongoose.model('Retailer', retailerSchema, 'retailers'),
  Wholesaler: mongoose.model('Wholesaler', wholesalerSchema, 'wholesalers'),
  Importer: mongoose.model('Importer', importerSchema, 'importers'),
  Rider: mongoose.model('Rider', riderSchema, 'riders'),
  ShoppingAgent: mongoose.model('ShoppingAgent', agentSchema, 'shoppingagents'),
};
