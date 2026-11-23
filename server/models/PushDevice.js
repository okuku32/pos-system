const mongoose = require('mongoose');

// A phone that can receive push notifications (the Android app registers its Firebase token after log-in).
// One token belongs to one person: logging in as someone else on the same phone moves it.
const pushDeviceSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    platform: { type: String, enum: ['android', 'ios', 'web'], required: true },
    token: { type: String, required: true, maxlength: 4096 },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
pushDeviceSchema.index({ token: 1 }, { unique: true });
pushDeviceSchema.index({ customer: 1 }); // a person's devices, when sending
pushDeviceSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }); // phones not seen for 90 days are dropped

module.exports = mongoose.model('PushDevice', pushDeviceSchema);
