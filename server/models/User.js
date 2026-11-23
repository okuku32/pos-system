const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Areas of the admin panel a moderator can be given (owners and admins always have all of them)
const PERMS = ['ads', 'sellers', 'orders', 'support'];
// the staff roles, highest first (see security/rbac.js for what each may do)
const ROLES = ['owner', 'admin', 'moderator'];
// owner or admin: the whole marketplace (only an owner also manages admins and money settings)
const isAdminLevel = (role) => role === 'owner' || role === 'admin';

// Staff accounts (owners, admins and moderators). Separate from marketplace Customers.
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 120 },
    password: { type: String, required: true, minlength: 6, select: false },
    // owner: everything, incl. admins and money settings · admin: everything else · moderator: only the areas in perms
    role: { type: String, enum: ROLES, default: 'moderator' },
    perms: { type: [{ type: String, enum: PERMS }], default: () => [...PERMS] },
    active: { type: Boolean, default: true },
    // bumped to sign the account out everywhere (disabled, password reset, "sign out everywhere")
    tokenVersion: { type: Number, default: 0 },
    // set by an admin (new account / password reset) or for old default passwords: must pick a new one first
    mustChangePassword: { type: Boolean, default: false },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: Date,
    lastLoginAt: Date,
    lastLoginIp: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// bcrypt, cost 11: strong (above the OWASP minimum of 10) and quick enough that logging in feels instant.
// A hash with a different cost is redone at the next successful login.
const BCRYPT_ROUNDS = 11;
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);
});

userSchema.methods.matchPassword = function (entered) {
  return bcrypt.compare(entered, this.password);
};

userSchema.methods.can = function (area) {
  return isAdminLevel(this.role) || (this.perms || []).includes(area);
};

// true when the stored hash uses fewer rounds than today's standard
userSchema.methods.needsRehash = function () {
  try {
    return !!this.password && bcrypt.getRounds(this.password) !== BCRYPT_ROUNDS;
  } catch {
    return false;
  }
};

const User = mongoose.model('User', userSchema);
User.PERMS = PERMS;
User.ROLES = ROLES;
User.isAdminLevel = isAdminLevel;
module.exports = User;
