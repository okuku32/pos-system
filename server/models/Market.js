const mongoose = require('mongoose');
const { pointSchema } = require('../market/geo');

// A real market (Gikomba, Wakulima, Kongowea…). Mama mbogas and traders register their stall in one, so buyers
// can find markets around them and see who sells there. Sellers can suggest a missing market; staff approve it.
const marketSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true },
    kind: { type: String, enum: ['fresh-produce', 'mitumba', 'mixed', 'wholesale'], default: 'mixed' },
    area: { type: String, trim: true, maxlength: 60, default: '' },
    county: { type: String, required: true, trim: true, maxlength: 40 },
    point: { type: pointSchema, required: true },
    days: { type: String, trim: true, maxlength: 80, default: '' }, // e.g. "Daily, busiest on Tuesdays and Fridays"
    about: { type: String, trim: true, maxlength: 400, default: '' },
    approved: { type: Boolean, default: true }, // suggestions from sellers wait for the team
    suggestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  },
  { timestamps: true }
);

marketSchema.index({ point: '2dsphere' });
marketSchema.index({ approved: 1, county: 1, name: 1 });

module.exports = mongoose.model('Market', marketSchema);
