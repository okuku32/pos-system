// A shopping agent ↔ a seller they work for. Made only when it happens: a buyer picks that agent for that seller's
// goods ("verify my goods" or "Book this agent"), or the agent takes the seller's inspection job. One record per pair;
// every new order between them is counted. The agent sees these sellers (with their contacts) in their app.
const mongoose = require('mongoose');

const agentSellerSchema = new mongoose.Schema(
  {
    agent: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    market: { type: mongoose.Schema.Types.ObjectId, ref: 'Market' }, // the seller's market (when they're in one)
    marketName: String,
    how: { type: String, enum: ['booked', 'auto', 'accepted', 'shopride'] }, // how they first met: the buyer booked the agent, linked automatically, the agent took a job, a Shop & ride booking
    orders: { type: Number, default: 0 }, // orders / bookings that linked them
    jobs: { type: Number, default: 0 }, // inspections the agent actually took for this seller
    lastOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    firstAt: Date,
    lastAt: Date,
  },
  { timestamps: true }
);
agentSellerSchema.index({ agent: 1, seller: 1 }, { unique: true }); // one record per pair
agentSellerSchema.index({ agent: 1, lastAt: -1 }); // an agent's sellers, most recent first
agentSellerSchema.index({ seller: 1, lastAt: -1 }); // a seller's agents

module.exports = mongoose.model('AgentSeller', agentSellerSchema);
