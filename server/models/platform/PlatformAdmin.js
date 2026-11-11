// You (the platform owner) and anyone you let manage all clients. Separate from each client's staff users.
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { platformConnection } = require('../../tenancy/context');

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 8, select: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

schema.pre('save', async function () {
  if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 10);
});
schema.methods.matchPassword = function (p) {
  return bcrypt.compare(p, this.password);
};

module.exports = platformConnection().model('PlatformAdmin', schema);
