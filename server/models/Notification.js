const mongoose = require('mongoose');

// A notification for a buyer or seller, in English and Kiswahili ("someone added your item to their cart",
// "new order", "your order is on the way"…). Sent live over the socket and kept for the 🔔 list.
const text = { en: { type: String, default: '' }, sw: { type: String, default: '' } };
const notificationSchema = new mongoose.Schema(
  {
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    kind: { type: String, enum: ['cart', 'order', 'call', 'work', 'request'], required: true }, // call: a missed in-app call · work: a job booked with a field agent / their documents · request: a buyer’s photo request
    icon: { type: String, default: '🔔' },
    title: text,
    body: text,
    link: { type: String, default: '' },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);
notificationSchema.index({ to: 1, createdAt: -1 });
notificationSchema.index({ to: 1, read: 1 }); // the unread 🔔 count (polled)
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 }); // kept for 90 days

module.exports = mongoose.model('Notification', notificationSchema);
