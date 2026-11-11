// A client business using the system. Lives in the platform (control) database, not in any tenant database.
const mongoose = require('mongoose');
const { platformConnection } = require('../../tenancy/context');

const SLUG_RX = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;
const RESERVED = new Set(['www', 'admin', 'api', 'app', 'platform', 'mail', 'static', 'cdn', 'assets', 'localhost']);

const tenantSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, match: SLUG_RX }, // web address: <slug>.yourdomain
    name: { type: String, required: true, trim: true, maxlength: 80 }, // business name shown on receipts and the shop
    dbName: { type: String, required: true, unique: true },
    domains: [{ type: String, lowercase: true, trim: true }], // optional custom domains, e.g. shop.client.co.ke
    status: { type: String, enum: ['trial', 'active', 'suspended'], default: 'trial', index: true },
    plan: { type: String, default: 'standard' },
    trialEndsAt: Date,
    contact: { name: String, email: String, phone: String },
    notes: String, // private notes for you (the platform owner)
    // Business settings the client manages themselves. Secret fields are stored encrypted (see tenancy/secrets.js).
    settings: {
      branding: { storeName: String, logoUrl: String, primaryColor: String },
      shop: { address: String, location: String, mapQuery: String, phone: String, whatsapp: String, email: String, hours: [[String]] },
      mpesa: { env: String, consumerKey: String, consumerSecret: String, shortcode: String, passkey: String, transactionType: String },
      etims: { mode: String, tin: String, bhfId: String, deviceSerial: String, traderName: String, address: String, defaultItemClass: String },
      email: { from: String, smtpHost: String, smtpPort: Number, smtpUser: String, smtpPass: String },
      taxRate: Number,
    },
    lastActiveAt: Date,
  },
  { timestamps: true }
);

tenantSchema.statics.SLUG_RX = SLUG_RX;
tenantSchema.statics.RESERVED = RESERVED;

module.exports = platformConnection().model('Tenant', tenantSchema);
