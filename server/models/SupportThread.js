const mongoose = require('mongoose');

// A customer support conversation. Customers don't need an account: they get a secret token
// (kept in their browser) that lets them continue the conversation.
const messageSchema = new mongoose.Schema(
  {
    from: { type: String, enum: ['customer', 'staff'], required: true },
    staffName: String,
    text: { type: String, required: true, maxlength: 2000 },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const supportThreadSchema = new mongoose.Schema(
  {
    ticketNo: { type: String, unique: true },
    token: { type: String, required: true, index: true }, // secret, 32 hex chars
    customer: {
      name: { type: String, trim: true, maxlength: 60 },
      email: { type: String, trim: true, lowercase: true, maxlength: 120 },
      phone: { type: String, trim: true, maxlength: 20 },
    },
    customerAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', index: true },
    topic: { type: String, enum: ['order', 'delivery', 'payment', 'product', 'other'], default: 'other' },
    orderNo: { type: String, trim: true, maxlength: 30 },
    status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    messages: [messageSchema],
    unreadByStaff: { type: Number, default: 0 },
    unreadByCustomer: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

supportThreadSchema.pre('save', function () {
  if (!this.ticketNo) {
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    this.ticketNo = `HELP-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }
});

module.exports = mongoose.model('SupportThread', supportThreadSchema);
