// Demo shopping agents: two trained agents in every approved market, each linked to that market
// (worker.market), so "Find a shopping agent here" on a market's page and Shop & ride coverage both work.
//   npm run seed:agents             add the missing ones (safe to run again: nothing is duplicated)
//   npm run seed:agents -- --remove  delete every demo agent again
// Logins: agent-<market-slug>-<n>@demo.kapu.test / Demo-Agent-2026
// The phone numbers are made up (0700 1xx xxx). Before going live, replace them with your real agents' numbers in
// Admin → Field team, or remove the demo agents.
require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Customer = require('../models/Customer');
const Market = require('../models/Market');

const PER_MARKET = 2;
const PASSWORD = 'Demo-Agent-2026';
const DOMAIN = 'demo.kapu.test';
const FIRST = ['Wanjiru', 'Otieno', 'Achieng', 'Kamau', 'Mwende', 'Kiprono', 'Njeri', 'Omondi', 'Wambui', 'Mutua', 'Atieno', 'Kibet', 'Nyambura', 'Barasa', 'Chebet', 'Mwangi', 'Akinyi', 'Wekesa', 'Muthoni', 'Juma'];
const LAST = ['Kariuki', 'Odhiambo', 'Wanjala', 'Njoroge', 'Cherono', 'Onyango', 'Mutiso', 'Kilonzo', 'Nduta', 'Ochieng', 'Kimani', 'Rotich', 'Owino', 'Gathoni', 'Masika'];

// the same market always gets the same names (deterministic), different markets get different people
// (every first name × surname pair once: 300 different people before any name repeats)
const nameFor = (index) => `${FIRST[index % FIRST.length]} ${LAST[(index % FIRST.length + Math.floor(index / FIRST.length)) % LAST.length]}`;

async function main() {
  await connectDB();
  if (process.argv.includes('--remove')) {
    const result = await Customer.deleteMany({ email: new RegExp(`^agent-.*@${DOMAIN.replace(/\./g, '\\.')}$`) });
    console.log(`Removed ${result.deletedCount} demo shopping agents.`);
    return;
  }
  const markets = await Market.find({ approved: true }).sort({ county: 1, name: 1 }).lean();
  const wanted = markets.flatMap((market, marketIndex) => Array.from({ length: PER_MARKET }, (_, n) => ({ market, n: n + 1, index: marketIndex * PER_MARKET + n })));
  // one read for what's there already (emails and phones), one write for everything new
  const emails = wanted.map(({ market, n }) => `agent-${market.slug}-${n}@${DOMAIN}`);
  const existing = new Set((await Customer.find({ email: { $in: emails } }).select('email').lean()).map((customer) => customer.email));
  const taken = new Set((await Customer.find({ phone: /^2547001/ }).select('phone').lean()).map((customer) => customer.phone));
  let next = 100001;
  const freePhone = () => {
    while (taken.has(`2547001${String(next).slice(1)}`)) next += 1;
    const phone = `2547001${String(next).slice(1)}`;
    taken.add(phone);
    next += 1;
    return phone;
  };
  const hash = await bcrypt.hash(PASSWORD, 11); // the same demo password for all of them: hashed once
  const now = new Date();
  const docs = wanted.filter(({ market, n }) => !existing.has(`agent-${market.slug}-${n}@${DOMAIN}`)).map(({ market, n, index }) => {
    const phone = freePhone();
    return {
      name: nameFor(index), email: `agent-${market.slug}-${n}@${DOMAIN}`, phone, password: hash, accountType: 'buyer',
      emailVerified: true, emailVerifiedAt: now, county: market.county, active: true,
      worker: {
        role: 'agent', status: 'approved', market: market._id, marketName: market.name, marketSlug: market.slug,
        base: market.point, baseArea: market.area || market.name, radiusKm: 1, available: true, vehicle: 'on foot',
        idNumber: String(20000000 + index * 7919).slice(0, 8), mpesaPhone: phone,
        rating: { avg: Math.round((4.4 + ((index * 37) % 6) / 10) * 10) / 10, count: 6 + ((index * 13) % 40) },
        appliedAt: now, approvedAt: now, reviewNote: 'Demo shopping agent',
      },
    };
  });
  if (docs.length) await Customer.insertMany(docs, { ordered: false });
  console.log(`${markets.length} markets · ${docs.length} demo shopping agents added · ${existing.size} were already there.`);
  if (docs.length) console.log(`Log in as any of them with ${docs[0].email} (and the others) / ${PASSWORD}`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
