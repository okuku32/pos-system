const mongoose = require('mongoose');

// Marketplace details an admin can edit (Admin → Settings). Secrets (M-Pesa keys, email password) stay in .env.
const siteSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'site', unique: true }, // a single document
    staffGate: { type: String, select: false }, // the private staff login link's key (never sent to the public site)
    name: { type: String, trim: true, maxlength: 60 },
    tagline: { type: String, trim: true, maxlength: 140 },
    social: { tiktok: String, instagram: String, facebook: String, x: String, youtube: String }, // full https links
    address: { type: String, trim: true, maxlength: 200 },
    phone: { type: String, trim: true, maxlength: 30 },
    whatsapp: { type: String, trim: true, maxlength: 30 },
    email: { type: String, trim: true, maxlength: 120 },
    hours: [[String]],
    mapsKey: { type: String, trim: true, maxlength: 120 }, // Google Maps browser key (restricted to the site's address)
    commissionPercent: { type: Number, min: 0, max: 50 }, // the marketplace's cut of online (M-Pesa) sales
    // riders & shopping agents: prices the buyer pays, and the share our field team earns
    fieldwork: {
      riderEnabled: Boolean, riderBase: Number, riderPerKm: Number, riderMin: Number, riderMaxKm: Number, riderSharePercent: Number,
      inspectEnabled: Boolean, inspectPercent: Number, inspectMin: Number, inspectMax: Number, agentSharePercent: Number,
      inspectFreeKm: Number, inspectFreeKg: Number, inspectBaseFee: Number, inspectBaseKm: Number,
      commissionPercent: Number, taxPercent: Number, payoutDelayMin: Number,
    },
    // courier for far deliveries (60 km+): companies and fares (see market/courier.js)
    courier: {
      enabled: Boolean, minKm: Number, maxKm: Number, handlingFee: Number, agentSharePercent: Number, assumeKg: Number,
      companies: [{ _id: false, id: String, name: String, active: Boolean, base: Number, perKm: Number, perKg: Number, min: Number, eta: String, note: String }],
    },
    // testing before M-Pesa is connected: M-Pesa checkouts are marked paid without money (only works while M-Pesa isn't set up)
    demoPayments: Boolean,
    // seasonal campaign banner on the home page (back to school, Black Friday, Christmas…)
    campaign: { active: Boolean, emoji: String, title: String, subtitle: String, link: String, cta: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SiteSettings', siteSettingsSchema);
