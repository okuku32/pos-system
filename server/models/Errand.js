const mongoose = require('mongoose');
const { pointSchema } = require('../market/geo');

// An errand: someone books our field team directly, without buying from a seller on Kapu.
//   parcel   — a rider picks something up anywhere and delivers it anywhere (fee paid to the rider on delivery)
//   shopping — a shopping agent buys a list of things at any shop / market, checks them and brings them. The budget and
//              the agent's service fee are paid upfront with M-Pesa (the agent never uses their own money); the agent
//              is refunded what they actually spent; any change goes back to the customer; delivery is paid on delivery.
//   shopride — Shop & ride with us: our agent collects what the buyer bought (anywhere in Nairobi), inspects and
//              repackages it, and brings it to our CBD hub; from there it goes to the pickup point in the buyer's area
//              (they get a message saying where to collect it) or on to their door. Paid upfront with M-Pesa.
//              collected → at_hub → at_point (waiting at the pickup point) | out_for_delivery (door) → done
// status: awaiting_payment (shopping, M-Pesa not yet paid) → open → assigned → picked_up (parcel collected / items
//         bought) → delivered (the worker says so) → done (the customer confirmed, or automatically after 24 h) | cancelled
const place = {
  address: String, name: String, phone: String, lat: Number, lng: Number,
};
const errandSchema = new mongoose.Schema(
  {
    no: { type: String, unique: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    customerName: String,
    customerPhone: String,
    kind: { type: String, enum: ['parcel', 'shopping', 'shopride'], required: true },
    shopride: {
      what: String, items: [{ _id: false, name: String, qty: Number, price: Number }], sellerName: String, stall: String, seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }, fromArea: String, fromCbd: Boolean, weightKg: Number,
      inspect: Boolean, repack: Boolean, urgency: { type: String, enum: ['standard', 'express'] },
      // the shopping agent the buyer booked (on a market's page): gets the job first
      agent: { _id: false, worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }, name: String, marketName: String },
      mode: { type: String, enum: ['point', 'door'] },
      point: { _id: false, id: String, name: String, area: String, address: String, hours: String, phone: String, lat: Number, lng: Number },
      price: { _id: false, inspection: Number, delivery: Number, repack: Number, door: Number, doorKm: Number, traffic: String, estimate: Boolean },
      readyAt: Date, // waiting at the pickup point since
      // the goods: paid by the buyer once our agent passes the inspection (to Kapu, who pays the seller at once);
      // with them the delivery fee (pickup point). Door delivery: the delivery fee is paid when it arrives (onDelivery).
      goods: {
        _id: false, amount: Number, delivery: Number, status: { type: String, enum: ['waiting', 'pending', 'paid', 'failed', 'cancelled'] },
        phone: String, checkoutRequestId: String, receipt: String, paidAt: Date, failReason: String,
        seller: { _id: false, status: { type: String, enum: ['due', 'sending', 'paid'] }, phone: String, ref: String, at: Date, error: String },
      },
      onDelivery: Number, // door: delivery fee (+ door fare) collected when it arrives
      deliveryCollected: Boolean,
      inspection: { _id: false, passed: Boolean, note: String, at: Date },
    },
    group: { type: String, index: true }, // one booking from several sellers: their errands share it
    pickup: { ...place, point: { type: pointSchema } },
    dropoff: place,
    // Ride with us: the vehicle the customer chose (motorbike = bike, car = 4-seater car, van = pickup), the trip's minutes
    // and the surge when booked (1 = none; why: rush hour, heavy traffic, high demand). The fare is fee.delivery.
    parcel: { what: String, size: { type: String, enum: ['small', 'medium', 'large'] }, vehicle: { type: String, enum: ['motorbike', 'car', 'van'] }, minutes: Number, surge: Number, surgeReasons: [String], payer: { type: String, enum: ['sender', 'recipient'] } },
    shopping: {
      list: [{ _id: false, name: String, qty: String, note: String }],
      shopName: String, budget: Number, spent: Number, receipt: String,
      // the quick way: the list written down (text) and / or photographed (private files: server/private/lists);
      // no budget at booking: the agent who takes it sends a price (quote), then the customer pays
      mode: { type: String, enum: ['items', 'list'] },
      text: String,
      photos: [{ _id: false, file: String, mime: String }],
      quote: { _id: false, amount: Number, service: Number, delivery: Number, note: String, at: Date, by: String },
    },
    notes: String,
    km: Number,
    fee: { delivery: Number, service: { type: Number, default: 0 } },
    payment: {
      method: { type: String, enum: ['mpesa', 'none'], default: 'none' },
      status: { type: String, enum: ['none', 'pending', 'paid', 'failed'], default: 'none' },
      amount: Number, phone: String, checkoutRequestId: { type: String, index: true }, receipt: String, paidAt: Date, failReason: String,
    },
    // shopping: what's left of the budget (or everything, if cancelled after paying) goes back to the customer
    refund: { amount: Number, status: { type: String, enum: ['none', 'due', 'refunded'], default: 'none' }, ref: String, at: Date },
    status: { type: String, enum: ['awaiting_payment', 'open', 'assigned', 'picked_up', 'at_hub', 'at_point', 'out_for_delivery', 'delivered', 'done', 'cancelled'], default: 'open', index: true },
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
    worker: { name: String, phone: String, vehicle: String, plate: String, role: String, tipPhone: String, stars: { avg: Number, count: Number }, live: { lat: Number, lng: Number, at: Date }, eta: { minutes: Number, at: Date, kmLeft: Number, kmToYou: Number, stage: String } },
    rated: Number, // the customer's stars for the rider / agent
    history: [{ _id: false, status: String, at: { type: Date, default: Date.now }, note: String }],
    cancelReason: String,
  },
  { timestamps: true }
);
errandSchema.index({ customer: 1, createdAt: -1 });
errandSchema.index({ 'refund.status': 1 });
errandSchema.index({ 'shopride.goods.checkoutRequestId': 1 }, { sparse: true });
errandSchema.index({ 'shopride.goods.seller.status': 1 }, { sparse: true }); // sellers still to be paid
errandSchema.index({ kind: 1, status: 1, createdAt: -1 }); // our team's Shop & ride board

module.exports = mongoose.model('Errand', errandSchema);
