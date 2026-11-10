const Sale = require('../models/Sale');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { salePrice } = require('../utils/pricing');
const asyncHandler = require('../utils/asyncHandler');

const TZ = 'Africa/Nairobi';

// Build a createdAt range from YYYY-MM-DD strings (defaults: last 30 days)
function range(from, to) {
  const end = to ? new Date(`${to}T23:59:59.999`) : new Date();
  let start;
  if (from) start = new Date(`${from}T00:00:00`);
  else {
    start = new Date(end);
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
  }
  return { $gte: start, $lte: end };
}

const round = (n) => +Number(n || 0).toFixed(2);

// GET /api/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
// Revenue = total paid (incl. tax). Net sales = subtotal - discount. Profit = net sales - cost of goods.
exports.summary = asyncHandler(async (req, res) => {
  const match = { status: 'completed', createdAt: range(req.query.from, req.query.to) };

  const [totalsAgg, daily, products, cashiers, methods, categories] = await Promise.all([
    Sale.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$total' },
          netSales: { $sum: { $subtract: ['$subtotal', { $ifNull: ['$discount', 0] }] } },
          cost: { $sum: '$totalCost' },
          profit: { $sum: '$profit' },
          discount: { $sum: '$discount' },
          tax: { $sum: '$tax' },
          count: { $sum: 1 },
          itemsSold: { $sum: { $sum: '$items.quantity' } },
        },
      },
    ]),
    Sale.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } },
          revenue: { $sum: '$total' },
          cost: { $sum: '$totalCost' },
          profit: { $sum: '$profit' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    // Per-product: item revenue is before order-level discount (discounts are reported separately)
    Sale.aggregate([
      { $match: match },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          name: { $last: '$items.name' },
          qty: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.subtotal' },
          cost: { $sum: { $multiply: [{ $ifNull: ['$items.cost', 0] }, '$items.quantity'] } },
        },
      },
      { $addFields: { profit: { $subtract: ['$revenue', '$cost'] } } },
      { $sort: { profit: -1 } },
    ]),
    Sale.aggregate([
      { $match: match },
      { $group: { _id: '$cashier', count: { $sum: 1 }, revenue: { $sum: '$total' }, profit: { $sum: '$profit' } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $project: { name: { $ifNull: [{ $first: '$user.name' }, 'Unknown'] }, count: 1, revenue: 1, profit: 1 } },
      { $sort: { revenue: -1 } },
    ]),
    Sale.aggregate([
      { $match: match },
      { $group: { _id: '$paymentMethod', count: { $sum: 1 }, revenue: { $sum: '$total' } } },
      { $sort: { revenue: -1 } },
    ]),
    Sale.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'p' } },
      {
        $group: {
          _id: { $ifNull: [{ $first: '$p.category' }, 'Deleted products'] },
          qty: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.subtotal' },
          cost: { $sum: { $multiply: [{ $ifNull: ['$items.cost', 0] }, '$items.quantity'] } },
        },
      },
      { $addFields: { profit: { $subtract: ['$revenue', '$cost'] } } },
      { $sort: { revenue: -1 } },
    ]),
  ]);

  const t = totalsAgg[0] || {};
  const totals = {
    revenue: round(t.revenue),
    netSales: round(t.netSales),
    cost: round(t.cost),
    profit: round(t.profit),
    discount: round(t.discount),
    tax: round(t.tax),
    count: t.count || 0,
    itemsSold: t.itemsSold || 0,
    avgSale: t.count ? round(t.revenue / t.count) : 0,
    margin: t.netSales ? round((t.profit / t.netSales) * 100) : 0, // % of net sales
  };

  // ---- Stock remaining after sales (current stock), plus units held in open (unpaid) orders ----
  const [allProducts, reservedAgg] = await Promise.all([
    Product.find({}, 'name category stock lowStockThreshold cost price discountPercent active').sort('name').lean(),
    Order.aggregate([
      { $match: { status: 'open' } },
      { $unwind: '$items' },
      { $group: { _id: '$items.product', qty: { $sum: '$items.quantity' } } },
    ]),
  ]);
  const soldById = new Map(products.map((p) => [String(p._id), p.qty]));
  const reservedById = new Map(reservedAgg.map((r) => [String(r._id), r.qty]));
  const stock = allProducts
    .map((p) => {
      const left = p.stock || 0;
      const reserved = reservedById.get(String(p._id)) || 0;
      const afterOrders = left - reserved;
      const threshold = p.lowStockThreshold ?? 5;
      return {
        _id: p._id,
        name: p.name,
        category: p.category,
        active: p.active,
        sold: soldById.get(String(p._id)) || 0, // units sold in the chosen period
        stock: left, // units on the shelf right now
        reserved,
        afterOrders,
        status: left <= 0 ? 'out' : afterOrders <= threshold || left <= threshold ? 'low' : 'ok',
        costValue: round(left * (p.cost || 0)),
        retailValue: round(left * salePrice(p)),
      };
    })
    // most urgent first: out of stock, then low, then by units left
    .sort((a, b) => ({ out: 0, low: 1, ok: 2 }[a.status] - { out: 0, low: 1, ok: 2 }[b.status]) || a.stock - b.stock);

  const active = stock.filter((s) => s.active);
  const stockTotals = {
    units: active.reduce((n, s) => n + Math.max(0, s.stock), 0),
    reserved: active.reduce((n, s) => n + s.reserved, 0),
    costValue: round(active.reduce((n, s) => n + Math.max(0, s.costValue), 0)),
    retailValue: round(active.reduce((n, s) => n + Math.max(0, s.retailValue), 0)),
    low: active.filter((s) => s.status === 'low').length,
    out: active.filter((s) => s.status === 'out').length,
    products: active.length,
  };

  // show what's left next to each product in the "By product" table
  const stockById = new Map(stock.map((s) => [String(s._id), s]));
  products.forEach((p) => {
    const s = stockById.get(String(p._id));
    p.stock = s ? s.stock : null; // null = product since deleted
    p.status = s ? s.status : 'deleted';
  });

  res.json({
    range: { from: match.createdAt.$gte, to: match.createdAt.$lte },
    totals,
    daily,
    products,
    cashiers,
    methods,
    categories,
    stock,
    stockTotals,
  });
});
