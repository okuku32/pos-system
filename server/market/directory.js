// Fills the people tables (buyers, retailers, wholesalers, importers, riders, shopping agents) from the accounts,
// ads, orders and jobs, and keeps them up to date:
//   · touch(customerId) after anything about that person changes: refreshed within a few seconds
//   · rebuild() once at start-up and every 30 minutes: everything checked again (nothing drifts)
const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Listing = require('../models/Listing');
const Order = require('../models/Order');
const Task = require('../models/Task');
const directory = require('../models/Directory');
const { IMPORTED } = require('./origins');
const trades = require('./trades');

const oid = (item) => new mongoose.Types.ObjectId(String(item));
const whoOf = (customer) => ({ customer: customer._id, name: customer.name, email: customer.email, phone: customer.phone || '', county: customer.shopLocation?.county || customer.county || '', active: customer.active !== false, joinedAt: customer.createdAt });

// upsert these rows, and remove rows (of the people looked at) that no longer belong in the table
async function write(Model, rows, scope) {
  const ops = rows.map((row) => ({ updateOne: { filter: { customer: row.customer }, update: { $set: row }, upsert: true } }));
  if (ops.length) await Model.bulkWrite(ops, { ordered: false });
  const keep = rows.map((row) => row.customer);
  // only among the people looked at (a full rebuild looks at everyone)
  await Model.deleteMany(scope ? { $and: [{ customer: { $in: scope } }, { customer: { $nin: keep } }] } : { customer: { $nin: keep } });
  return rows.length;
}

async function rebuild(ids = null) {
  const scope = ids ? [...new Set(ids.map(String))].map(oid) : null;
  const inScope = (field) => (scope ? { [field]: { $in: scope } } : {});

  // ---------------- buyers
  const [orderRows, signedUpBuyers] = await Promise.all([
    Order.aggregate([
      { $match: { ...inScope('buyer'), status: { $ne: 'awaiting_payment' } } },
      { $group: {
        _id: '$buyer', orders: { $sum: 1 },
        delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        spent: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, '$total', 0] } },
        sellers: { $addToSet: '$seller' }, first: { $min: '$createdAt' }, last: { $max: '$createdAt' },
      } },
    ]),
    Customer.find({ ...inScope('_id'), accountType: 'buyer', 'worker.role': { $exists: false } }).select('_id').lean(),
  ]);
  const buyerIdsLater = () => {
    // buyers: everyone who has ordered, plus people who signed up to buy and don't sell or work for us
    const sellers = new Set(adRows.map((adRow) => String(adRow._id)));
    return [...new Set([...orderRows.map((orderRow) => String(orderRow._id)), ...signedUpBuyers.map((signedUpBuyer) => String(signedUpBuyer._id)).filter((id) => !sellers.has(id))])];
  };
  // ---------------- sellers: what their live ads are
  const [adRows, salesRows] = await Promise.all([
    Listing.aggregate([
      { $match: { ...inScope('seller'), status: 'active' } },
      { $group: {
        _id: '$seller', all: { $sum: 1 }, last: { $max: '$createdAt' }, cats: { $addToSet: '$category' },
        // retail: sold one at a time (not wholesale-only)
        retail: { $sum: { $cond: [{ $or: [{ $ne: ['$wholesale.enabled', true] }, { $eq: ['$wholesale.retail', true] }] }, 1, 0] } },
        retailCats: { $addToSet: { $cond: [{ $or: [{ $ne: ['$wholesale.enabled', true] }, { $eq: ['$wholesale.retail', true] }] }, '$category', '$$REMOVE'] } },
        wholesale: { $sum: { $cond: [{ $eq: ['$wholesale.enabled', true] }, 1, 0] } },
        wholesaleCats: { $addToSet: { $cond: [{ $eq: ['$wholesale.enabled', true] }, '$category', '$$REMOVE'] } },
        units: { $addToSet: { $cond: [{ $eq: ['$wholesale.enabled', true] }, '$wholesale.unit', '$$REMOVE'] } },
        imported: { $sum: { $cond: [{ $in: ['$origin', IMPORTED] }, 1, 0] } },
        importedCats: { $addToSet: { $cond: [{ $in: ['$origin', IMPORTED] }, '$category', '$$REMOVE'] } },
        origins: { $addToSet: { $cond: [{ $in: ['$origin', IMPORTED] }, '$origin', '$$REMOVE'] } },
      } },
    ]),
    Order.aggregate([
      { $match: { ...inScope('seller'), status: 'delivered' } },
      { $group: { _id: '$seller', sales: { $sum: 1 }, revenue: { $sum: '$subtotal' }, last: { $max: '$updatedAt' } } },
    ]),
  ]);
  // ---------------- riders & shopping agents: their finished jobs and money
  const [workers, jobRows] = await Promise.all([
    Customer.find({ ...inScope('_id'), 'worker.role': { $in: ['rider', 'agent'] } }).lean(),
    Task.aggregate([
      { $match: { ...inScope('worker'), worker: { $ne: null } } },
      { $group: {
        _id: '$worker',
        jobs: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
        active: { $sum: { $cond: [{ $in: ['$status', ['assigned', 'picked_up', 'delivered']] }, 1, 0] } },
        inspections: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'done'] }, { $or: [{ $eq: ['$kind', 'inspection'] }, { $eq: ['$inspect', true] }] }] }, 1, 0] } },
        fees: { $sum: { $ifNull: ['$money.gross', 0] } }, earned: { $sum: { $ifNull: ['$money.net', 0] } },
        sent: { $sum: { $cond: [{ $eq: ['$payout.status', 'paid'] }, { $ifNull: ['$money.toPay', 0] }, 0] } },
        balance: { $sum: { $cond: [{ $in: ['$payout.status', ['waiting', 'due', 'owed', 'sending']] }, { $ifNull: ['$money.toPay', 0] }, 0] } },
        tips: { $sum: { $sum: { $ifNull: ['$tips.amount', []] } } },
        last: { $max: '$doneAt' },
      } },
    ]),
  ]);

  const buyerIds = buyerIdsLater();
  // the accounts we need
  const need = [...new Set([...buyerIds, ...adRows.map((adRow) => String(adRow._id))])].map(oid);
  const people = new Map((await Customer.find({ _id: { $in: need } }).lean()).map((item) => [String(item._id), item]));
  workers.forEach((worker) => people.set(String(worker._id), worker));
  const sales = new Map(salesRows.map((salesRow) => [String(salesRow._id), salesRow]));
  const jobs = new Map(jobRows.map((jobRow) => [String(jobRow._id), jobRow]));

  // buyers
  const byOrder = new Map(orderRows.map((orderRow) => [String(orderRow._id), orderRow]));
  const buyers = buyerIds.map((id) => {
    const person = people.get(id);
    if (!person) return null;
    const orderEntry = byOrder.get(id);
    return { ...whoOf(person), county: person.county || person.shopLocation?.county || '', orders: orderEntry?.orders || 0, delivered: orderEntry?.delivered || 0, cancelled: orderEntry?.cancelled || 0, spent: orderEntry?.spent || 0, averageOrder: orderEntry?.delivered ? Math.round(orderEntry.spent / orderEntry.delivered) : 0, sellers: orderEntry?.sellers.length || 0, firstOrderAt: orderEntry?.first, lastOrderAt: orderEntry?.last };
  }).filter(Boolean);

  // sellers by kind (a seller can be in more than one)
  const retailers = [];
  const wholesalers = [];
  const importers = [];
  for (const adRow of adRows) {
    const person = people.get(String(adRow._id));
    if (!person || person.active === false) continue;
    const kinds = person.shopLocation?.kinds || [];
    const sale = sales.get(String(adRow._id));
    const base = {
      ...whoOf(person), shop: person.shopLocation?.name || '', area: person.shopLocation?.area || '', market: person.shopLocation?.marketName || '', kinds,
      verified: !!person.verified, rating: person.rating?.avg || 0, reviews: person.rating?.count || 0, allAds: adRow.all, sales: sale?.sales || 0, revenue: sale?.revenue || 0, lastSaleAt: sale?.last, lastAdAt: adRow.last,
    };
    if (adRow.retail > 0) retailers.push({ ...base, ads: adRow.retail, categories: adRow.retailCats });
    if (adRow.wholesale > 0 || kinds.includes('wholesaler')) wholesalers.push({ ...base, ads: adRow.wholesale, categories: adRow.wholesaleCats, trades: trades.tradesOfCats('wholesale', adRow.wholesaleCats.length ? adRow.wholesaleCats : adRow.cats), units: adRow.units.filter(Boolean) });
    if (adRow.imported > 0 || kinds.includes('importer')) importers.push({ ...base, ads: adRow.imported, categories: adRow.importedCats, trades: trades.tradesOfCats('importer', adRow.importedCats.length ? adRow.importedCats : adRow.cats), origins: adRow.origins });
  }

  // riders & shopping agents
  const workerRow = (value) => {
    const worker = value.worker;
    const job = jobs.get(String(value._id)) || {};
    return {
      ...whoOf(value), county: value.county || '', status: worker.status, available: worker.available !== false, baseArea: worker.baseArea || '', market: worker.marketName || '', radiusKm: worker.radiusKm, mpesaPhone: worker.mpesaPhone || value.phone || '',
      jobs: job.jobs || 0, activeJobs: job.active || 0, fees: job.fees || 0, earned: job.earned || 0, sent: job.sent || 0, balance: job.balance || 0, tips: job.tips || 0, lastJobAt: job.last, appliedAt: worker.appliedAt, approvedAt: worker.approvedAt,
    };
  };
  const riders = workers.filter((worker) => worker.worker.role === 'rider').map((item) => ({ ...workerRow(item), vehicle: item.worker.vehicle || '', plate: item.worker.plate || '' }));
  const agents = workers.filter((worker) => worker.worker.role === 'agent').map((item) => ({ ...workerRow(item), inspections: jobs.get(String(item._id))?.inspections || 0 }));

  const counts = {
    buyers: await write(directory.Buyer, buyers, scope),
    retailers: await write(directory.Retailer, retailers, scope),
    wholesalers: await write(directory.Wholesaler, wholesalers, scope),
    importers: await write(directory.Importer, importers, scope),
    riders: await write(directory.Rider, riders, scope),
    shoppingAgents: await write(directory.ShoppingAgent, agents, scope),
  };
  return counts;
}

// ---------------------------------------------------------------- keeping it fresh
const pending = new Set();
let timer = null;
let busy = false;
function touch(...ids) {
  for (const id of ids.flat()) if (id && mongoose.isValidObjectId(String(id))) pending.add(String(id));
  if (!timer && pending.size) timer = setTimeout(flush, 3000); // a few changes together, one refresh
}
async function flush() {
  timer = null;
  if (busy) return void (timer = setTimeout(flush, 2000));
  const ids = [...pending];
  pending.clear();
  if (!ids.length) return;
  busy = true;
  try {
    await rebuild(ids);
  } catch (error) {
    console.error('People tables:', error.message);
  } finally {
    busy = false;
  }
}
function start() {
  const full = () => {
    if (busy) return;
    busy = true;
    rebuild().catch((error) => console.error('People tables:', error.message)).finally(() => { busy = false; });
  };
  const run = require('../utils/jobs').every('people-tables', 30 * 60 * 1000, full); // one server at a time
  setTimeout(run, 4000); // after start-up
}

module.exports = { rebuild, touch, flush, start, tables: directory };
