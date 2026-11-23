// npm run staff-link: prints the private link where owners, admins and moderators sign in (/staff/<key>).
// The key lives only in the database (the public site never shows it), so this needs the server's .env (MONGO_URI):
// only someone with access to the server can run it. Share the link privately with your team.
//   npm run staff-link            → the current link
//   npm run staff-link -- --new   → a new link (the old one stops working; everyone opens the new one)
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const staffGate = require('../middleware/staffGate');
  const key = process.argv.includes('--new') ? await staffGate.rotateGate() : await staffGate.loadGate();
  // the address people open: the shop's address in production, the local app while developing
  const siteAddress = (process.env.SHOP_URL || process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
  console.log(`${process.argv.includes('--new') ? 'New staff' : 'Staff'} sign-in link: ${siteAddress}/staff/${key}`);
  console.log('Keep it private: anyone signing in still needs a staff account and password.');
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error(error.message || error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
