const mongoose = require('mongoose');

// Lipa Pole Pole sale agreement made directly between a buyer and a seller who live near each other (furniture).
// Kapu provides the agreement form and keeps the record; the money moves directly between the two people
// (cash or M-Pesa to the seller), so it is NOT protected by Lipa Salama. Both parties accept the agreement in the app.
const partySchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    name: String,
    phone: String,
    email: String,
    idNumber: String, // national ID / passport number, shown only to the two parties and the marketplace team
    address: String, // estate / town
    county: String,
    acceptedAt: Date,
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  date: { type: Date, required: true },
  method: { type: String, enum: ['cash', 'mpesa', 'bank', 'other'], default: 'cash' },
  ref: String, // M-Pesa code, receipt number…
  recordedBy: { type: String, enum: ['buyer', 'seller'] },
  status: { type: String, enum: ['confirmed', 'pending'], default: 'confirmed' }, // buyer-reported payments wait for the seller
  at: { type: Date, default: Date.now },
});

const agreementSchema = new mongoose.Schema(
  {
    agreementNo: { type: String, unique: true },
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
    item: { title: String, slug: String, image: String, category: String, sub: String, description: String },
    seller: partySchema,
    buyer: partySchema,
    createdBy: { type: String, enum: ['buyer', 'seller'] },
    agreementDate: { type: Date, default: Date.now },
    price: { type: Number, required: true }, // total agreed price
    deposit: { type: Number, default: 0 }, // paid when signing
    deadline: { type: Date, required: true }, // full payment by
    schedule: { type: String, default: '' }, // e.g. "KSh 5,000 every Friday"
    possession: { type: String, enum: ['buyer_now', 'after_payment'], default: 'after_payment' }, // who keeps the item meanwhile
    notes: { type: String, default: '' },
    payments: [paymentSchema],
    // waiting_buyer / waiting_seller: the other party hasn't accepted yet · active · completed (fully paid) · cancelled
    status: { type: String, enum: ['waiting_buyer', 'waiting_seller', 'active', 'completed', 'cancelled'], default: 'waiting_buyer', index: true },
    cancelReason: String,
    cancelledBy: String,
    policyVersion: { type: String, default: '2026-11' },
  },
  { timestamps: true }
);
agreementSchema.index({ 'seller.customer': 1, createdAt: -1 });
agreementSchema.index({ 'buyer.customer': 1, createdAt: -1 });
agreementSchema.index({ conversation: 1, createdAt: -1 }); // the agreement for a chat (opened with every chat)
agreementSchema.index({ listing: 1, status: 1 }); // sold-ad cleanup: is an agreement still running?
agreementSchema.index({ 'seller.customer': 1, updatedAt: -1 }); // my agreements, latest change first
agreementSchema.index({ 'buyer.customer': 1, updatedAt: -1 });
agreementSchema.index({ status: 1, updatedAt: -1 }); // admin list

agreementSchema.virtual('paid').get(function paid() {
  return (this.payments || []).filter((payment) => payment.status === 'confirmed').reduce((total, item) => total + item.amount, 0);
});

module.exports = mongoose.model('Agreement', agreementSchema);
