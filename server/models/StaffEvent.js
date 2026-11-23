const mongoose = require('mongoose');

// Staff sign-ins and team changes, shown to admins under Admin → Team (kept 180 days)
const staffEventSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  email: String,
  name: String,
  action: { type: String, required: true }, // login, login_failed, locked, password_changed, user_created, user_updated, user_deleted, signed_out, link_changed
  by: String, // the admin who did it (for team changes)
  ip: String,
  detail: String,
  at: { type: Date, default: Date.now },
});
staffEventSchema.index({ at: -1 });
staffEventSchema.index({ at: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

module.exports = mongoose.model('StaffEvent', staffEventSchema);
