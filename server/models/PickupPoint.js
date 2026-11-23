const mongoose = require('mongoose');
const { pointSchema } = require('../market/geo');

// Our drop-off / pickup points around Nairobi (Shop & ride with us). The hub (CBD) is where items bought outside the
// CBD are brought first; from there they go to the pickup point in the buyer's area, or on to their door.
const pickupPointSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    area: { type: String, required: true, trim: true, maxlength: 60 },
    address: { type: String, trim: true, maxlength: 200 },
    landmark: { type: String, trim: true, maxlength: 120 },
    hours: { type: String, trim: true, maxlength: 80 },
    phone: { type: String, trim: true, maxlength: 20 },
    point: { type: pointSchema, required: true },
    hub: { type: Boolean, default: false },
    order: Number, // the order within its area (Embakasi: Fedha stage first …)
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
pickupPointSchema.index({ point: '2dsphere' });
pickupPointSchema.index({ active: 1, area: 1 });

module.exports = mongoose.model('PickupPoint', pickupPointSchema);
