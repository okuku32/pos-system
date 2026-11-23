const mongoose = require('mongoose');
const { pointSchema } = require('../market/geo');

// A job for our field team, tied to one order:
//   delivery   — a rider takes the order from the shop to the buyer
//   inspection — an agent checks the items at the shop (right item, size, colour, quality) before dispatch
// status: open (waiting for someone near) → assigned → done (delivered / inspected) | cancelled
const taskSchema = new mongoose.Schema(
  {
    // shopping: an errand — buy the customer's list at any shop and bring it (shopping agents)
    kind: { type: String, enum: ['delivery', 'inspection', 'shopping', 'verification'], required: true }, // verification: a partner shop checks a Safe deal item
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', index: true }, // an order on Kapu…
    errand: { type: mongoose.Schema.Types.ObjectId, ref: 'Errand', index: true }, // …or an errand booked directly
    delivery: { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery' }, // the delivery record (one per store of a split order)
    leg: Number, // which part of a split order (1 = the first; its status drives the order's rider details)
    budget: Number, // shopping: the most the agent may spend (paid upfront by the customer)
    spent: Number, // shopping: what the agent actually spent (refunded to them)
    // shopping, the quick way: the customer's list (text + how many photos) and the agent's price for it.
    // The agent buys only once the customer has paid (quote.paidAt).
    list: { _id: false, text: String, photos: Number },
    quote: { _id: false, needed: Boolean, amount: Number, sentAt: Date, paidAt: Date },
    receipt: String,
    orderNo: String,
    // delivered = the rider says it's delivered, waiting for the buyer to confirm (done once both have)
    status: { type: String, enum: ['open', 'assigned', 'picked_up', 'delivered', 'done', 'cancelled'], default: 'open', index: true },
    riderConfirmedAt: Date,
    buyerConfirmedAt: Date,
    tips: [{ _id: false, amount: Number, at: { type: Date, default: Date.now } }], // sent by the buyer straight to the rider's M-Pesa
    // where the work happens: the seller's shop (pickup / inspection) and, for delivery, the buyer
    pickup: { name: String, address: String, area: String, point: { type: pointSchema, required: true }, phone: String },
    dropoff: { address: String, area: String, lat: Number, lng: Number, phone: String, name: String },
    km: Number, // shop → buyer (delivery)
    // Ride with us: the rider vehicles that may take this job (the customer chose a boda, a car or a van); unset = any
    vehicles: { type: [String], default: undefined },
    items: [{ _id: false, title: String, qty: Number, attrs: mongoose.Schema.Types.Mixed, image: String }],
    buyerNotes: String, // what the buyer wants checked (inspection)
    inspect: Boolean, // a delivery that starts with an inspection at the shop (one agent does both)
    // far deliveries: take it to the courier's office near the shop, pay the fare, send it, enter the waybill
    courier: { company: String, name: String, fare: Number, eta: String, toTown: String, waybill: String, office: String, actualFare: Number, overClaim: Number, sentAt: Date },
    fee: Number, // what the buyer paid for this job
    pay: Number, // what the rider / agent earns
    collectCash: { type: Number, default: 0 }, // the agent collected this part of the fee themselves (cash / M-Pesa on delivery)
    reimburse: { type: Number, default: 0 }, // courier fare the agent paid for the buyer (refunded in full)
    // the money, worked out when the job is done: fee − commission − tax = net; toPay = net − cash + reimburse
    money: { gross: Number, commission: Number, tax: Number, net: Number, cash: Number, reimburse: Number, toPay: Number },
    worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', index: true },
    workerName: String,
    workerPhone: String,
    acceptedAt: Date,
    pickedUpAt: Date,
    // matching: the riders offered the job first (nearest with room, best rated); then everyone in reach at wave2At
    matched: [{ _id: false, worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }, km: Number, eta: Number, at: Date }],
    matchedCount: Number,
    wave2At: Date,
    // the shopping agent the buyer booked: offered to them alone until `until`, then to everyone (see alertNearby)
    preferred: { _id: false, worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }, name: String, marketName: String, until: Date },
    // live tracking: where the rider is and when they'll arrive (updated from the rider app)
    live: { lat: Number, lng: Number, at: Date },
    eta: { minutes: Number, at: Date, kmLeft: Number, kmToYou: Number, stage: String },
    rating: { stars: Number, comment: String, at: Date }, // the buyer rated the rider
    onTheWayAt: Date, // the rider tapped “On my way” (to the buyer)
    arrivedAt: Date, // the rider tapped “I’ve arrived”
    doneAt: Date,
    // inspection result
    result: {
      passed: Boolean,
      checks: { rightItem: Boolean, size: Boolean, colour: Boolean, quality: Boolean, matchesAd: Boolean, works: Boolean, condition: Boolean, genuine: Boolean },
      serial: String, // verification: serial / IMEI / chassis number recorded by the partner
      note: String,
    },
    // weekly pay
    week: String, // "2026-W46" (when the job was finished)
    // waiting: the 30-minute hold · due: ready (sent by hand when M-Pesa transfers aren't set up) · owed: the agent owes us
    // (cash jobs), taken off their next payout · sending / paid: in an M-Pesa transfer (Payout)
    payout: { status: { type: String, enum: ['none', 'unpaid', 'paid', 'waiting', 'due', 'owed', 'sending'], default: 'none' }, dueAt: Date, paidAt: Date, ref: String, payout: { type: mongoose.Schema.Types.ObjectId, ref: 'Payout' } },
  },
  { timestamps: true }
);
taskSchema.index({ status: 1, kind: 1, 'pickup.point': '2dsphere' }); // open jobs near a rider: skips finished jobs instead of walking them by distance
taskSchema.index({ status: 1, updatedAt: -1 }); // admin: tasks, latest first
taskSchema.index({ worker: 1, 'rating.at': -1 }, { partialFilterExpression: { 'rating.stars': { $gte: 1 } } }); // a rider's reviews
taskSchema.index({ status: 1, wave2At: 1 }, { sparse: true });
taskSchema.index({ 'preferred.worker': 1, status: 1 }, { sparse: true }); // jobs booked with me
taskSchema.index({ worker: 1, status: 1, doneAt: -1 });
taskSchema.index({ 'payout.status': 1, week: 1 });
taskSchema.index({ 'payout.status': 1, 'payout.dueAt': 1 }); // the payout run
taskSchema.index({ worker: 1, 'payout.status': 1 });
taskSchema.index({ status: 1, doneAt: -1 }); // earnings by period
taskSchema.index({ 'payout.payout': 1 }, { sparse: true });

module.exports = mongoose.model('Task', taskSchema);
