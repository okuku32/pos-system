const mongoose = require('mongoose');

// A delivery record: one shipment of (part of) an order. One order → one or more deliveries — more than one when
// fulfilment is split, i.e. the order's items ship from different stores of the seller (one record per store).
// Each record has its own status, rider job (Task) and timestamps; the order is delivered when all of them are.
//
// status: pending (being prepared) → ready (packed) → assigned (a rider took it) → picked_up → on_the_way → delivered
//         or cancelled
const deliverySchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNo: String,
    seq: { type: Number, required: true }, // 1, 2… within the order
    of: { type: Number, required: true }, // how many deliveries the order has
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
    storeName: String,
    storeArea: String,
    items: [{ _id: false, listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' }, title: String, qty: Number, image: String }],
    method: String, // as the order: delivery · pickup · walk · rider · courier · verified
    status: { type: String, enum: ['pending', 'ready', 'assigned', 'picked_up', 'on_the_way', 'delivered', 'cancelled'], default: 'pending' },
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' }, // our rider's job for this delivery
    riderName: String,
    riderPhone: String,
    fee: { type: Number, default: 0 }, // what this delivery costs
    paidBy: { type: String, enum: ['buyer', 'seller', 'none'], default: 'none' }, // extra deliveries of a split order: the seller
    note: String, // e.g. the seller's own delivery person, or a courier waybill
    readyAt: Date,
    pickedUpAt: Date,
    deliveredAt: Date,
    history: [{ _id: false, status: String, at: { type: Date, default: Date.now }, by: String, note: String }],
  },
  { timestamps: true }
);

deliverySchema.index({ order: 1, seq: 1 }, { unique: true }); // never two "part 1"s
deliverySchema.index({ seller: 1, status: 1, createdAt: -1 });
deliverySchema.index({ buyer: 1, createdAt: -1 });
deliverySchema.index({ task: 1 }, { sparse: true });

module.exports = mongoose.model('Delivery', deliverySchema);
