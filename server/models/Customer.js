const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { pointSchema } = require('../market/geo');

// Shop customers (separate from staff Users, so a customer login can never reach staff routes)
const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 120 },
    // stored as 2547XXXXXXXX. Optional: Google sign-ups add it at their first checkout
    phone: { type: String, unique: true, sparse: true, trim: true },
    // not set for accounts that only use Google sign-in
    password: { type: String, minlength: 6, select: false },
    googleId: { type: String, unique: true, sparse: true },
    authProvider: { type: String, enum: ['password', 'google'], default: 'password' },
    avatar: { type: String, default: '' },
    address: { type: String, trim: true, maxlength: 200 }, // last delivery address, pre-filled at checkout
    county: { type: String, trim: true, maxlength: 40 },
    // what they mainly came for (chosen at log in / sign up): decides where they land and what's shown first.
    // Everyone can still both buy and sell.
    // what a seller said they sell when they joined (mama mboga, mama samaki, importer, chemist…): pre-ticks their shop type
    sellerTypes: { type: [String], default: undefined },
    sellerCategories: { type: [String], default: undefined }, // what a seller sells (market category slugs), from sign-up
    sellerItems: { type: [String], default: undefined }, // the types inside those categories: 'electronics/phones'…
    // wholesalers and importers: what they deal in (category slugs, also in sellerCategories) and, for importers,
    // the countries they import from (ISO codes). Checked before every save (market/sellerProfile.js normalizeTrade).
    trade: {
      type: new mongoose.Schema({
        wholesale: { type: [String], default: undefined },
        imports: { type: [String], default: undefined },
        importFrom: { type: [{ type: String, match: /^[A-Z]{2}$/ }], default: undefined },
        vehicles: { type: [String], default: undefined }, // vehicle importers: 'Toyota/Vitz', 'Nissan/*' (every model)
        spares: { type: [String], default: undefined }, // spare-parts importers: 'Brakes', 'Engine & gearbox'…
        updatedAt: Date,
      }, { _id: false }),
      default: undefined,
    },
    accountType: { type: String, enum: ['buyer', 'seller'], default: 'buyer' },
    tradeAskedAt: Date, // a seller answered "importer or wholesaler?" (asked once, after logging in)
    about: { type: String, trim: true, maxlength: 300 }, // shown on the seller's public page
    // the seller's real shop / pick-up place (pin from Google Maps or the phone's GPS). Shown to buyers only when public.
    shopLocation: {
      name: { type: String, trim: true, maxlength: 80 },
      address: { type: String, trim: true, maxlength: 200 },
      area: { type: String, trim: true, maxlength: 60 },
      county: { type: String, trim: true, maxlength: 40 },
      placeId: { type: String, trim: true, maxlength: 300 },
      point: { type: pointSchema, default: undefined },
      public: { type: Boolean, default: false },
      updatedAt: Date,
      // what kind of seller: shop, wholesaler, boutique (men's / women's / kids' wear), mama mboga, market stall
      kinds: { type: [{ type: String, enum: ['shop', 'wholesaler', 'boutique', 'mama-mboga', 'samaki', 'market-stall', 'chemist', 'electronics', 'spares', 'baby-shop', 'grocery', 'importer'] }], default: undefined },
      wear: { type: [{ type: String, enum: ['men', 'women', 'kids'] }], default: undefined },
      // the market their stall is in (copied name/slug so cards don't need another lookup)
      market: { type: mongoose.Schema.Types.ObjectId, ref: 'Market' },
      marketName: String,
      marketSlug: String,
      stall: { type: String, trim: true, maxlength: 40 }, // e.g. "Stall 112, near gate B"
      // opening hours, set by the seller (see market/hours.js)
      hours: {
        always: Boolean,
        days: { type: [{ _id: false, closed: Boolean, open: String, close: String }], default: undefined },
        override: { state: String, until: Date, note: String },
      },
      // walking delivery for buyers close to the shop (see market/walk.js)
      walk: {
        enabled: { type: Boolean, default: false },
        maxKm: Number, fee: Number, perItem: Number, maxFee: Number, freeOver: Number,
        afterSale: Boolean, // free: an after-sale service
        note: String,
      },
    },
    // chemists: their Pharmacy and Poisons Board premises licence, checked by our team before they can sell medicines
    chemist: {
      status: { type: String, enum: ['none', 'pending', 'verified', 'rejected'], default: 'none' },
      licenceNo: String,
      premises: String, // registered premises name
      pharmacist: String, // pharmacist / pharm-tech in charge
      at: Date,
      verifiedAt: Date,
      reviewNote: String,
    },
    // how buyers pay this seller on delivery: M-Pesa Till, Paybill + account, Pochi la Biashara or Send Money
    payDetails: { method: { type: String, enum: ['till', 'paybill', 'pochi', 'phone'] }, till: String, paybill: String, account: String, phone: String, name: String },
    // the seller's own Daraja (Lipa Na M-Pesa Online) app, so buyers get an M-Pesa prompt that pays them directly.
    // payConnect is what may be shown; payKeys are encrypted (utils/secretBox) and never loaded unless asked for.
    payConnect: { shortcode: String, env: { type: String, enum: ['production', 'sandbox'] }, connectedAt: Date },
    payKeys: { type: { _id: false, consumerKey: String, consumerSecret: String, passkey: String }, select: false },
    // our field team: riders (deliveries) and shopping agents (check items at the shop before dispatch)
    worker: {
      role: { type: String, enum: ['rider', 'agent', 'partner'] }, // partner: a shop that verifies second-hand items (Safe deal)
      shopName: String, // partners: the shop's name, street address, business permit and opening hours
      shopAddress: String,
      permitNo: String,
      hours: String,
      status: { type: String, enum: ['pending', 'approved', 'rejected', 'suspended'] },
      idNumber: String,
      vehicle: String, // motorbike, bicycle, tuk-tuk, car, on foot
      plate: String,
      base: { type: pointSchema, default: undefined }, // where they usually wait / their market
      baseArea: String,
      // shopping agents: the market they work in (required), as sellers have shopLocation.market
      market: { type: mongoose.Schema.Types.ObjectId, ref: 'Market' },
      marketName: String,
      marketSlug: String,
      radiusKm: Number,
      available: { type: Boolean, default: true },
      capacity: Number, // riders: how many jobs they carry at once (1–6; default by vehicle, see market/riders.js)
      live: { type: pointSchema, default: undefined }, // where they are now (shared from the rider app while working)
      liveAt: Date,
      rating: { avg: Number, count: Number }, // buyers' stars after delivery
      mpesaPhone: String, // where their weekly pay goes
      appliedAt: Date,
      approvedAt: Date,
      reviewNote: String,
      // their documents (ID, driving licence, insurance…): the files are private (server/private/worker-docs), seen only
      // by them and our team. Expiry dates are checked by moderators; an expired licence or insurance stops new jobs.
      docs: {
        type: [{
          kind: { type: String, enum: ['id', 'licence', 'insurance', 'psv', 'good_conduct', 'logbook', 'permit', 'other'], required: true },
          label: String, // "other": what it is
          number: String,
          expiresAt: Date,
          file: { type: String, required: true },
          mime: String,
          size: Number,
          uploadedAt: { type: Date, default: Date.now },
          status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
          reviewNote: String,
          reviewedAt: Date,
          reviewedBy: String,
          reminded: String, // the last expiry reminder sent: '30' | '7' | 'expired'
        }],
        default: undefined,
      },
    },
    // trust: a team member checked who this seller is (ID / phone call), plus ratings from delivered orders
    verified: { type: Boolean, default: false },
    verifiedAt: Date,
    verifyRequest: { status: { type: String, enum: ['none', 'pending', 'rejected'], default: 'none' }, note: String, at: Date, reviewNote: String },
    rating: { avg: { type: Number, default: 0 }, count: { type: Number, default: 0 } },
    completedSales: { type: Number, default: 0 },
    // 📈 the POS dashboard (shops, wholesalers, importers: not one-off sellers of a single item), switched on with one button
    pos: { _id: false, enabled: Boolean, at: Date },
    businessBoostUntil: Date, // a market trader's "boost my business" (KSh 200 a month): all their ads + their shop featured until then
    active: { type: Boolean, default: true },
    // Password reset: only a SHA-256 hash of the emailed token is stored, so a database leak can't be used to reset
    // Email verification: new accounts can't log in until they open the link we email them. Only a SHA-256 hash of
    // the token is stored; it expires after 24 hours. (No default: accounts from before verification existed are
    // marked verified once at start-up, so nobody already using the site is locked out.)
    emailVerified: Boolean,
    emailVerifiedAt: Date,
    verifyTokenHash: { type: String, select: false },
    verifyTokenExpires: { type: Date, select: false },
    verifySentAt: { type: Date, select: false },
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
    // Logins issued before this moment are no longer accepted (set when the password is reset)
    passwordChangedAt: Date,
    // too many wrong passwords: locked for a while (per account; the IP limit is in the route)
    failedLogins: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, select: false },
    lastLoginAt: Date,
    lastSeenAt: Date, // last time they had the site open (online / offline badge)
  },
  { timestamps: true }
);

customerSchema.index({ 'shopLocation.point': '2dsphere' }, { sparse: true });
customerSchema.index({ 'shopLocation.market': 1 }, { sparse: true });
customerSchema.index({ 'trade.wholesale': 1 }, { sparse: true }); // wholesalers of a category
customerSchema.index({ 'trade.imports': 1 }, { sparse: true }); // importers of a category
customerSchema.index({ 'trade.importFrom': 1 }, { sparse: true }); // importers from a country
customerSchema.index({ 'worker.base': '2dsphere' }, { sparse: true });
customerSchema.index({ 'worker.live': '2dsphere' }, { sparse: true }); // rider matching: where riders are now (market/riders.js)
customerSchema.index({ 'worker.status': 1, 'worker.role': 1 });
customerSchema.index({ 'worker.role': 1, 'worker.status': 1 }); // riders / agents near a job
customerSchema.index({ 'worker.market': 1, 'worker.role': 1, 'worker.status': 1 }, { sparse: true }); // a market's shopping agents
customerSchema.index({ 'chemist.status': 1 }, { sparse: true });
customerSchema.index({ 'worker.docs.expiresAt': 1 }, { sparse: true }); // documents about to expire (daily reminders, moderators) // chemists near me (licensed only)
customerSchema.index({ 'verifyRequest.status': 1 }, { sparse: true }); // admin: verification requests
customerSchema.index({ createdAt: -1 }); // admin dashboard: new accounts
customerSchema.index({ verifyTokenHash: 1 }, { sparse: true }); // the email verification link
customerSchema.index({ resetTokenHash: 1 }, { sparse: true }); // the password reset link

// bcrypt, cost 11: strong (above the OWASP minimum of 10) and quick enough that logging in feels instant.
// A hash with a different cost is redone at the next successful login.
const BCRYPT_ROUNDS = 11;
// the trade always matches the seller's kinds and categories (no duplicates, nothing left over), however it was written
customerSchema.pre('validate', function () {
  if (this.trade && (this.isNew || this.isModified('trade') || this.isModified('sellerTypes') || this.isModified('sellerCategories'))) require('../market/sellerProfile').normalizeTrade(this);
});

customerSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return; // removed (Google-only account): nothing to hash
  this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);
});

customerSchema.methods.matchPassword = function (entered) {
  if (!this.password) return Promise.resolve(false); // Google-only account
  return bcrypt.compare(entered, this.password);
};

// true when the stored hash uses fewer rounds than today's standard
customerSchema.methods.needsRehash = function () {
  try {
    return !!this.password && bcrypt.getRounds(this.password) !== BCRYPT_ROUNDS;
  } catch {
    return false;
  }
};

module.exports = mongoose.model('Customer', customerSchema);
