// npm run seed: creates the marketplace's first staff account, the OWNER (only if there's no staff account yet).
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='Your-Strong-Pass-2026' npm run seed
// Without ADMIN_PASSWORD a strong random password is made and printed once. Either way the owner must choose their
// own password at the first sign-in (mustChangePassword). Sign in through the private staff link: npm run staff-link
require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');

// 16 random characters with upper and lower case letters and digits (always meets the staff password rules)
function randomStrongPassword() {
  const randomPart = crypto.randomBytes(12).toString('base64url').replace(/[-_]/g, '');
  return `Kp${randomPart.slice(0, 12)}7x`;
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) throw new Error('Set ADMIN_EMAIL to the owner’s email, e.g. ADMIN_EMAIL=you@example.com npm run seed');
  if (await User.exists({})) {
    console.log('Staff accounts already exist: nothing created. Add people in the admin panel under Team.');
  } else {
    const password = process.env.ADMIN_PASSWORD || randomStrongPassword();
    await User.create({ name: 'Owner', email, password, role: 'owner', mustChangePassword: true });
    console.log(`Created the owner: ${email}`);
    if (!process.env.ADMIN_PASSWORD) console.log(`Temporary password (shown once): ${password}`);
    console.log('Sign in through the private staff link (npm run staff-link); you will choose your own password first.');
  }
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error(error.message || error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
