const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Shop customers (separate from staff Users, so a customer login can never reach staff routes)
const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 120 },
    // stored as 2547XXXXXXXX. Optional: Google sign-ups add it at their first checkout
    phone: { type: String, unique: true, sparse: true, trim: true },
    // not set for accounts that only use Google sign-in
    password: { type: String, minlength: 6, select: false },
    googleId: { type: String, unique: true, sparse: true },
    authProvider: { type: String, enum: ['password', 'google'], default: 'password' },
    avatar: { type: String, default: '' },
    address: { type: String, trim: true, maxlength: 200 }, // last delivery address, pre-filled at checkout
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

customerSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

customerSchema.methods.matchPassword = function (entered) {
  if (!this.password) return Promise.resolve(false); // Google-only account
  return bcrypt.compare(entered, this.password);
};

module.exports = mongoose.model('Customer', customerSchema);
