const mongoose = require('mongoose');

// One M-Pesa transfer to a rider / shopping agent: the jobs it pays for, and how the money adds up
// (agent fees − our commission − tax − cash they already collected + courier fares refunded = amount).
const payoutSchema = new mongoose.Schema(
  {
    worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    name: String,
    phone: String, // the M-Pesa number it went to
    method: { type: String, enum: ['b2c', 'demo', 'manual'], required: true }, // b2c: sent automatically · manual: an admin sent it and typed the code
    status: { type: String, enum: ['sending', 'paid', 'failed'], default: 'sending' },
    amount: { type: Number, required: true },
    gross: Number, commission: Number, tax: Number, cash: Number, reimburse: Number,
    jobs: Number,
    tasks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Task' }],
    ref: String, // M-Pesa transaction code
    conversationId: String, // Safaricom B2C
    originatorId: String,
    error: String,
    retried: Boolean, // an admin chose to try a failed one again
    by: String, // the admin who sent it by hand
    paidAt: Date,
  },
  { timestamps: true }
);
payoutSchema.index({ worker: 1, createdAt: -1 });
payoutSchema.index({ status: 1, createdAt: -1 });
payoutSchema.index({ conversationId: 1 }, { sparse: true });
payoutSchema.index({ originatorId: 1 }, { sparse: true });

module.exports = mongoose.model('Payout', payoutSchema);
