// npm run staff-reset -- you@example.com [--owner]
// Recovery for a staff account when nobody can reset it in the panel (forgotten password, locked, or no owner left):
//   · gives the account a new strong temporary password (printed once); they choose their own at the next sign-in
//   · unlocks it, re-enables it, and signs it out everywhere
//   · --owner also makes it the owner (e.g. when there's no owner or admin left to manage the team)
// It needs the server's .env (MONGO_URI): only someone with access to the server / database can run it. Every use is
// recorded in the team's sign-in log.
require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');

// 16 characters with upper and lower case letters and digits (always meets the staff password rules)
function randomStrongPassword() {
  const randomPart = crypto.randomBytes(12).toString('base64url').replace(/[-_]/g, '');
  return `Kp${randomPart.slice(0, 12)}7x`;
}

(async () => {
  const email = (process.argv.slice(2).find((argument) => !argument.startsWith('--')) || '').trim().toLowerCase();
  const makeOwner = process.argv.includes('--owner');
  if (!email) throw new Error('Which account? e.g.  npm run staff-reset -- you@example.com --owner');
  await mongoose.connect(process.env.MONGO_URI);
  const user = await User.findOne({ email });
  if (!user) {
    const emails = (await User.find().select('email role').lean()).map((account) => `${account.email} (${account.role})`);
    throw new Error(`No staff account with the email ${email}. Staff accounts: ${emails.join(', ') || 'none (open the staff link to create the owner)'}`);
  }
  const temporaryPassword = randomStrongPassword();
  const changes = ['password reset', 'unlocked'];
  user.password = temporaryPassword;
  user.mustChangePassword = true; // they choose their own password before doing anything else
  user.failedLogins = 0;
  user.lockedUntil = undefined;
  if (!user.active) { user.active = true; changes.push('enabled'); }
  if (makeOwner && user.role !== 'owner') { user.role = 'owner'; user.perms = [...User.PERMS]; changes.push('role → owner'); }
  user.tokenVersion = (user.tokenVersion || 0) + 1; // any session still open (on any device) ends now
  await user.save();
  await require('../models/StaffEvent').create({ user: user._id, email: user.email, name: user.name, action: 'user_updated', by: 'server console', detail: changes.join(' · ') }).catch(() => {});
  console.log(`✔ ${user.email} (${user.role}): ${changes.join(', ')}`);
  console.log(`  Temporary password (shown once): ${temporaryPassword}`);
  console.log('  Sign in through the private staff link (npm run staff-link) and choose your own password.');
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error(error.message || error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
