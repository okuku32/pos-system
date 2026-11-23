const mongoose = require('mongoose');

// A marketplace order: what one buyer bought from ONE seller (a checkout with items from three sellers
// creates three orders that share a checkoutId and one M-Pesa payment).
//
// status:  awaiting_payment (M-Pesa not yet paid) → placed → confirmed → shipped → delivered
//          or cancelled at any point before shipping
// payment: mpesa (paid to the marketplace, passed on to the seller minus commission) or cod (cash on delivery)
const itemSchema = new mongoose.Schema(
  {
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
    store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' }, // the store it ships from (its delivery record: models/Delivery.js)
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    title: String,
    slug: String,
    image: String,
    category: String,
    price: Number,
    qty: { type: Number, min: 1 },
    subtotal: Number,
    offStock: Boolean, // bought at an agreed price on an ad that isn't sold online: no stock to count
    attrs: { type: mongoose.Schema.Types.Mixed }, // size, colour, model… as listed when bought (for the receipt)
    sub: String,
    condition: String,
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNo: { type: String, unique: true },
    checkoutId: { type: String, index: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    buyerName: String,
    buyerPhone: String,
    buyerEmail: String,
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    sellerName: String,
    items: [itemSchema],
    subtotal: Number,
    deliveryFee: { type: Number, default: 0 },
    payOnDelivery: { type: Number, default: 0 }, // paid in cash on delivery (inspected orders: the delivery fee); the rest was paid upfront
    weightKg: Number, // about how heavy the parcel is
    total: Number,
    delivery: {
      method: { type: String, enum: ['delivery', 'pickup', 'walk', 'rider', 'courier', 'verified'], default: 'delivery' }, // verified: Safe deal (checked at a partner shop, then our rider), // walk: the shop sends someone on foot · rider: one of our riders · courier: our agent sends it by bus / courier (far away)
      km: Number, // walking delivery: distance from the shop
      minutes: Number,
      lat: Number, // walking delivery: where the buyer is
      lng: Number,
      free: String, // walking delivery: why it's free ('after-sale', 'over', 'free')
      county: String,
      address: String,
      notes: String,
      pickupArea: String, // seller's area, for pickup orders
      placeId: String, // Google Maps place of the delivery address
      pin: String, // how the buyer placed the pin: gps | search | pin | typed
      accuracy: Number, // GPS accuracy (m)
    },
    payment: {
      method: { type: String, enum: ['mpesa', 'cod'], required: true },
      // pending → paid | failed (M-Pesa) · cod orders are 'cod' until delivered, then 'paid'
      status: { type: String, enum: ['pending', 'paid', 'failed', 'cod', 'refund_due', 'refunded'], default: 'pending' },
      phone: String,
      checkoutRequestId: { type: String, index: true },
      receipt: String, // the M-Pesa code
      ref: String, // our payment ID (PAY-XXXXXXXX), given once the payment is complete
      paidAt: Date,
      failReason: String,
      // split payment (a checkout with several sellers): this order is paid straight to its seller's own M-Pesa
      direct: Boolean,
      channel: { type: String, enum: ['stk', 'manual'] }, // stk: we send the prompt (seller connected Daraja) · manual: the buyer pays and gives the code
      seq: Number, // prompt order within the checkout (one M-Pesa prompt at a time per phone)
      amount: Number, // what is paid now to this seller
      to: { _id: false, method: String, till: String, paybill: String, account: String, phone: String, name: String, text: String, shortcode: String },
      promptedAt: Date,
      claimCode: String, // manual: the M-Pesa code the buyer sent us (never shown to the seller)
      claimedAt: Date,
      sellerCode: String, // manual: the M-Pesa code the seller says they received; compared with the buyer's
      sellerCodeAt: Date,
      mismatch: Boolean, // the two codes differ: the buyer re-checks theirs, the seller theirs (our team sees it)
      // our verification & inspection fee for split payments (paid to Kapu, one prompt for the checkout);
      // amount = base (an inspection the buyer asked for) + the split-payment fee; it is the order's inspection fee
      fee: {
        _id: false, amount: Number, base: Number, status: { type: String, enum: ['none', 'pending', 'paid', 'failed'] },
        checkoutRequestId: String, promptedAt: Date, receipt: String, paidAt: Date, failReason: String,
      },
      lock: Date, // the checkout's prompt lock (held on its first order)
    },
    status: { type: String, enum: ['awaiting_payment', 'placed', 'confirmed', 'shipped', 'delivered', 'cancelled'], default: 'placed', index: true },
    history: [{ status: String, at: { type: Date, default: Date.now }, by: String, note: String }],
    // our field team (optional extras the buyer chose and pays for)
    rider: {
      fee: Number, pay: Number, task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' }, status: String, name: String, phone: String,
      vehicle: String, plate: String, tipPhone: String, // the rider's M-Pesa number, for tips
      // the rider found by the buyer's scan at the checkout: told at once, and offered the job first when it opens
      preferred: { _id: false, worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }, name: String, vehicle: String, at: Date },
      combined: Boolean, // one of our agents inspects AND delivers
      // far deliveries: our agent sends it by courier (fare + handling = fee)
      courier: { company: String, name: String, fare: Number, handling: Number, eta: String, waybill: String, office: String, actualFare: Number, sentAt: Date },
      tip: Number, tippedAt: Date,
      live: { lat: Number, lng: Number, at: Date }, eta: { minutes: Number, at: Date, kmLeft: Number, kmToYou: Number, stage: String }, // live tracking
      stars: { avg: Number, count: Number }, rated: Number, matching: String, // the rider's rating; the buyer's stars; who was matched
      pickedUpAt: Date, onTheWayAt: Date, arrivedAt: Date, // where the delivery is (📦 → 🚚 → 🛵 → 📍 → ✅, see market/transit.js)
    },
    inspection: {
      fee: Number, pay: Number, notes: String, task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
      status: { type: String, enum: ['waiting', 'open', 'assigned', 'passed', 'failed', 'cancelled'] }, // waiting = until the seller confirms
      result: String, agentName: String, agentPhone: String, // the agent who took the job (the buyer and seller can call them) rechecks: { type: Number, default: 0 },
      // the shopping agent the buyer chose (on a market's page): gets the inspection first
      preferred: { _id: false, worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }, name: String, marketName: String, phone: String },
      rated: Number, // the buyer's stars for the inspection agent (1–5)
      by: { type: String, enum: ['rider', 'agent'] }, // rider: our rider checks at pickup, free · agent: our shopping agent (paid)
      free: Boolean,
    },
    // the buyer's own choice at checkout: 'inspect' (“Inspect my goods”, KSh 200) or 'none' (“Don't inspect”, no fee).
    // Recorded with the time, so it can always be shown what the buyer agreed to. Unset on orders from before.
    inspectionChoice: { type: String, enum: ['inspect', 'none'] },
    inspectionChoiceAt: Date,
    // Safe deal: the seller drops the item at our partner shop; it's verified before the seller is paid and our rider delivers it
    verification: {
      partner: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }, partnerName: String, partnerPhone: String, address: String, area: String, hours: String, lat: Number, lng: Number,
      fee: Number, pay: Number, task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
      // waiting (until the seller confirms) → awaiting_dropoff → received → passed | failed · cancelled
      status: { type: String, enum: ['waiting', 'awaiting_dropoff', 'received', 'passed', 'failed', 'cancelled'] },
      checks: { matchesAd: Boolean, works: Boolean, condition: Boolean, genuine: Boolean }, serial: String, note: String,
      dropoffBy: Date, receivedAt: Date, verifiedAt: Date, refund: Number,
      help: [{ _id: false, note: String, at: { type: Date, default: Date.now } }],
    },
    // the seller's M-Pesa details when the order was placed (for paying on delivery)
    sellerPay: { ...{ method: { type: String, enum: ['till', 'paybill', 'pochi', 'phone'] }, till: String, paybill: String, account: String, phone: String, name: String }, text: String },
    shipNote: String, // e.g. rider name and phone, or courier and tracking number
    cancelReason: String,
    cancelledBy: String,
    // removed from that person's own order list (finished orders only); the order itself is kept
    hiddenBy: { buyer: { type: Boolean, default: false }, seller: { type: Boolean, default: false } },
    // what the marketplace owes the seller for M-Pesa orders (cash-on-delivery money goes straight to the seller)
    commissionPercent: { type: Number, default: 0 },
    commission: { type: Number, default: 0 },
    splitDeliveryFee: { type: Number, default: 0 }, // riders for the extra parts of a split order (other stores): the seller's cost
    payout: {
      status: { type: String, enum: ['not_due', 'due', 'paid'], default: 'not_due' },
      amount: Number,
      ref: String,
      paidAt: Date,
      early: Boolean, // released before delivery (our team had checked / collected the goods)
      releasedAt: Date,
      why: String,
    },
    emailsSent: { type: Map, of: Boolean, default: {} },
    notifiedStatus: String, // the last status the buyer & seller were notified about (🔔)
  },
  { timestamps: true }
);

// never saved: an inspection fee on an order whose buyer chose “Don't inspect” (see market/inspectionChoice.js)
orderSchema.pre('validate', function checkInspectionConsent() {
  try {
    require('../market/inspectionChoice').assertNoFeeWithoutConsent(this);
  } catch (error) {
    this.invalidate('inspection.fee', error.message);
  }
});

orderSchema.index({ buyer: 1, createdAt: -1 });
orderSchema.index({ 'rider.task': 1 }, { sparse: true }); // the order of a rider's job (accept, picked up, delivered, live location)
orderSchema.index({ seller: 1, createdAt: -1 });
orderSchema.index({ seller: 1, status: 1 }); // badge counts: orders to handle (polled)
orderSchema.index({ buyer: 1, status: 1 }); // badge counts: my active orders (polled)
orderSchema.index({ 'items.listing': 1, status: 1 }); // sold-ad cleanup: is this ad in an open order?
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ 'payout.status': 1 });
orderSchema.index({ seller: 1, status: 1, updatedAt: -1 }); // Seller hub: sales and earnings by period
orderSchema.index({ 'items.store': 1, status: 1 }, { sparse: true }); // a store's open orders (before closing it)
orderSchema.index({ 'verification.status': 1, 'verification.dropoffBy': 1 }, { sparse: true }); // Safe deals the seller never dropped off
orderSchema.index({ createdAt: -1 }); // admin: all orders, newest first
orderSchema.index({ 'payment.receipt': 1 }, { sparse: true }); // an M-Pesa code can pay for one order only
orderSchema.index({ 'payment.ref': 1 }, { sparse: true }); // find an order by its payment ID
orderSchema.index({ 'payment.claimCode': 1 }, { sparse: true });
orderSchema.index({ 'payment.sellerCode': 1 }, { sparse: true });
orderSchema.index({ 'payment.fee.checkoutRequestId': 1 }, { sparse: true });

// New collection name: the old grocery-shop orders stay untouched in "orders"
module.exports = mongoose.model('Order', orderSchema, 'marketorders');
