// The agent ↔ seller relationship (models/AgentSeller.js): written only when an agent is actually linked to a
// seller's goods, in one bulk write however many pairs there are.
//   link([{ agent, seller, how, order?, job? }])  → upserts the pairs (counts the order / job)
//   sellersOf(agentId)                             → the sellers an agent works for, with their shop and contacts
const AgentSeller = require('../models/AgentSeller');
const Customer = require('../models/Customer');

async function link(pairs) {
  const list = (pairs || []).filter((pair) => pair?.agent && pair?.seller && String(pair.agent) !== String(pair.seller));
  if (!list.length) return 0;
  // the sellers' markets, in one read
  const sellers = new Map((await Customer.find({ _id: { $in: [...new Set(list.map((pair) => String(pair.seller)))] } }).select('shopLocation.market shopLocation.marketName').lean()).map((seller) => [String(seller._id), seller.shopLocation || {}]));
  const now = new Date();
  const result = await AgentSeller.bulkWrite(list.map((pair) => {
    const shop = sellers.get(String(pair.seller)) || {};
    return {
      updateOne: {
        filter: { agent: pair.agent, seller: pair.seller },
        update: {
          $setOnInsert: { firstAt: now, how: pair.how || 'auto' },
          $set: { lastAt: now, ...(shop.market ? { market: shop.market, marketName: shop.marketName || '' } : {}), ...(pair.order ? { lastOrder: pair.order } : {}) },
          $inc: { orders: pair.order ? 1 : 0, jobs: pair.job ? 1 : 0 },
        },
        upsert: true,
      },
    };
  }), { ordered: false });
  return (result.upsertedCount || 0) + (result.modifiedCount || 0);
}

async function sellersOf(agentId, limit = 50) {
  const rows = await AgentSeller.find({ agent: agentId }).sort({ lastAt: -1 }).limit(limit).lean();
  const people = new Map((await Customer.find({ _id: { $in: rows.map((row) => row.seller) } }).select('name phone shopLocation.name shopLocation.area shopLocation.stall shopLocation.marketName').lean()).map((person) => [String(person._id), person]));
  return rows.map((row) => {
    const person = people.get(String(row.seller)) || {};
    return {
      _id: row.seller, name: person.name || 'Seller', shop: person.shopLocation?.name || '', area: person.shopLocation?.area || '', stall: person.shopLocation?.stall || '',
      market: row.marketName || person.shopLocation?.marketName || '', phone: person.phone || '', orders: row.orders, jobs: row.jobs, how: row.how, since: row.firstAt, last: row.lastAt,
    };
  });
}

module.exports = { link, sellersOf };
