// Admin → People: the buyers, retailers, wholesalers, importers, riders and shopping agents tables
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const directory = require('../market/directory');
const currentDirectory = require('../models/Directory');
const trades = require('../market/trades');

const KINDS = {
  buyers: { model: currentDirectory.Buyer, sorts: { spent: { spent: -1 }, orders: { orders: -1 }, recent: { lastOrderAt: -1 }, newest: { joinedAt: -1 }, name: { name: 1 } }, sum: ['orders', 'delivered', 'cancelled', 'spent'] },
  retailers: { model: currentDirectory.Retailer, sorts: { revenue: { revenue: -1 }, ads: { ads: -1 }, sales: { sales: -1 }, rating: { rating: -1, reviews: -1 }, newest: { joinedAt: -1 }, name: { name: 1 } }, sum: ['ads', 'sales', 'revenue'] },
  wholesalers: { model: currentDirectory.Wholesaler, sorts: { revenue: { revenue: -1 }, ads: { ads: -1 }, sales: { sales: -1 }, rating: { rating: -1, reviews: -1 }, newest: { joinedAt: -1 }, name: { name: 1 } }, sum: ['ads', 'sales', 'revenue'], trade: 'wholesale' },
  importers: { model: currentDirectory.Importer, sorts: { revenue: { revenue: -1 }, ads: { ads: -1 }, sales: { sales: -1 }, rating: { rating: -1, reviews: -1 }, newest: { joinedAt: -1 }, name: { name: 1 } }, sum: ['ads', 'sales', 'revenue'], trade: 'importer' },
  riders: { model: currentDirectory.Rider, sorts: { jobs: { jobs: -1 }, earned: { earned: -1 }, balance: { balance: -1 }, recent: { lastJobAt: -1 }, newest: { appliedAt: -1 }, name: { name: 1 } }, sum: ['jobs', 'fees', 'earned', 'sent', 'balance'] },
  'shopping-agents': { model: currentDirectory.ShoppingAgent, sorts: { jobs: { jobs: -1 }, earned: { earned: -1 }, balance: { balance: -1 }, recent: { lastJobAt: -1 }, newest: { appliedAt: -1 }, name: { name: 1 } }, sum: ['jobs', 'inspections', 'fees', 'earned', 'sent', 'balance'] },
};
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /api/admin/people  → how many in each table
exports.counts = asyncHandler(async (req, res) => {
  const out = {};
  for (const [key, value] of Object.entries(KINDS)) out[key] = await value.model.estimatedDocumentCount();
  res.json({ counts: out, trades: { wholesale: trades.publicTrades('wholesale'), importer: trades.publicTrades('importer') } });
});

// GET /api/admin/people/:kind?q=&sort=&page=&county=&trade=&origin=&status=&all=1
exports.list = asyncHandler(async (req, res) => {
  const kind = KINDS[req.params.kind];
  if (!kind) throw httpError('Not found', 404);
  const filter = {};
  const query = String(req.query.q || '').trim().slice(0, 60);
  if (query) {
    const rx = new RegExp(escape(query), 'i');
    // phone numbers are stored as 2547…: "0712 345" finds them too
    const digits = query.replace(/[\s+-]/g, '');
    const phone = /^\d{3,}$/.test(digits) ? new RegExp(escape(digits.replace(/^0/, '254'))) : rx;
    filter.$or = [{ name: rx }, { email: rx }, { phone }, { shop: rx }, { market: rx }, { baseArea: rx }, { plate: rx }];
  }
  if (req.query.county) filter.county = String(req.query.county).slice(0, 40);
  if (kind.trade && req.query.trade && trades.tradeOf(kind.trade, String(req.query.trade))) filter.trades = String(req.query.trade);
  if (req.params.kind === 'importers' && req.query.origin) filter.origins = String(req.query.origin).slice(0, 20);
  if (['riders', 'shopping-agents'].includes(req.params.kind) && ['pending', 'approved', 'suspended', 'rejected'].includes(req.query.status)) filter.status = req.query.status;
  const sort = kind.sorts[req.query.sort] || Object.values(kind.sorts)[0];
  const all = req.query.all === '1'; // CSV
  const per = all ? 5000 : 50;
  const page = Math.max(1, Math.min(500, parseInt(req.query.page, 10) || 1));
  const group = { _id: null, n: { $sum: 1 } };
  kind.sum.forEach((item) => { group[item] = { $sum: `$${item}` }; });
  const [rows, [tot]] = await Promise.all([
    kind.model.find(filter).sort({ ...sort, _id: 1 }).skip(all ? 0 : (page - 1) * per).limit(per).lean(),
    kind.model.aggregate([{ $match: filter }, { $group: group }]),
  ]);
  const { _id, n: number, ...sums } = tot || { n: 0 };
  res.json({ kind: req.params.kind, rows, total: number || 0, page, pages: Math.max(1, Math.ceil((number || 0) / per)), totals: sums, updatedAt: rows.reduce((total, row) => (row.updatedAt > total ? row.updatedAt : total), null) });
});

// POST /api/admin/people/refresh  → rebuild every table now
exports.refresh = asyncHandler(async (req, res) => {
  const counts = await directory.rebuild();
  res.json({ message: 'Tables refreshed', counts });
});
