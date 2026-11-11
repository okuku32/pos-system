const Sale = require('../models/Sale');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Purchase = require('../models/Purchase');
const Expense = require('../models/Expense');
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

  // ---- Purchases in the period ----
  // Stock received is counted on the day it arrived, payments on the day they were made.
  const period = match.createdAt;
  const notCancelled = { status: { $ne: 'cancelled' } };
  const [ordered, receivedBySupplier, receivedByProduct, paidAgg, owedAgg] = await Promise.all([
    Purchase.aggregate([
      { $match: { ...notCancelled, createdAt: period } },
      { $group: { _id: '$supplier', name: { $last: '$supplierName' }, orders: { $sum: 1 }, orderedValue: { $sum: '$total' } } },
    ]),
    Purchase.aggregate([
      { $match: notCancelled },
      { $unwind: '$deliveries' },
      { $match: { 'deliveries.at': period } },
      { $unwind: '$deliveries.lines' },
      {
        $group: {
          _id: '$supplier',
          name: { $last: '$supplierName' },
          receivedValue: { $sum: { $multiply: ['$deliveries.lines.quantity', '$deliveries.lines.unitCost'] } },
          units: { $sum: '$deliveries.lines.quantity' },
          deliveries: { $addToSet: '$deliveries._id' },
        },
      },
      { $addFields: { deliveries: { $size: '$deliveries' } } },
    ]),
    Purchase.aggregate([
      { $match: notCancelled },
      { $unwind: '$deliveries' },
      { $match: { 'deliveries.at': period } },
      { $unwind: '$deliveries.lines' },
      {
        $group: {
          _id: '$deliveries.lines.product',
          name: { $last: '$deliveries.lines.name' },
          qty: { $sum: '$deliveries.lines.quantity' },
          cost: { $sum: { $multiply: ['$deliveries.lines.quantity', '$deliveries.lines.unitCost'] } },
          suppliers: { $addToSet: '$supplierName' },
        },
      },
      { $addFields: { avgCost: { $cond: [{ $gt: ['$qty', 0] }, { $divide: ['$cost', '$qty'] }, 0] } } },
      { $sort: { cost: -1 } },
    ]),
    Purchase.aggregate([
      { $match: notCancelled },
      { $unwind: '$payments' },
      { $match: { 'payments.at': period } },
      { $group: { _id: { supplier: '$supplier', method: '$payments.method' }, name: { $last: '$supplierName' }, paid: { $sum: '$payments.amount' } } },
    ]),
    // owed right now (all time), per supplier
    Purchase.aggregate([
      { $match: notCancelled },
      { $group: { _id: '$supplier', name: { $last: '$supplierName' }, owed: { $sum: { $max: [{ $subtract: ['$receivedValue', '$amountPaid'] }, 0] } } } },
    ]),
  ]);

  // one row per supplier combining everything above
  const bySupplier = new Map();
  const row = (id, name) => {
    const k = String(id);
    if (!bySupplier.has(k)) bySupplier.set(k, { _id: id, name, orders: 0, orderedValue: 0, deliveries: 0, units: 0, receivedValue: 0, paid: 0, owed: 0 });
    const r = bySupplier.get(k);
    if (name) r.name = name;
    return r;
  };
  ordered.forEach((o) => Object.assign(row(o._id, o.name), { orders: o.orders, orderedValue: round(o.orderedValue) }));
  receivedBySupplier.forEach((o) => Object.assign(row(o._id, o.name), { deliveries: o.deliveries, units: o.units, receivedValue: round(o.receivedValue) }));
  const paidByMethod = {};
  paidAgg.forEach((p) => {
    row(p._id.supplier, p.name).paid = round(row(p._id.supplier, p.name).paid + p.paid);
    paidByMethod[p._id.method] = round((paidByMethod[p._id.method] || 0) + p.paid);
  });
  owedAgg.forEach((o) => { if (o.owed > 0.004) row(o._id, o.name).owed = round(o.owed); });
  const purchaseSuppliers = [...bySupplier.values()]
    .filter((r) => r.orders || r.receivedValue || r.paid || r.owed)
    .sort((a, b) => b.receivedValue - a.receivedValue || b.owed - a.owed);

  const purchaseTotals = {
    orders: purchaseSuppliers.reduce((n, r) => n + r.orders, 0),
    orderedValue: round(purchaseSuppliers.reduce((n, r) => n + r.orderedValue, 0)),
    receivedValue: round(purchaseSuppliers.reduce((n, r) => n + r.receivedValue, 0)),
    unitsReceived: purchaseSuppliers.reduce((n, r) => n + r.units, 0),
    paid: round(purchaseSuppliers.reduce((n, r) => n + r.paid, 0)),
    owedNow: round(purchaseSuppliers.reduce((n, r) => n + r.owed, 0)),
    paidByMethod,
    // money in from sales minus money out to suppliers, in this period
    netCash: round(totals.revenue - purchaseSuppliers.reduce((n, r) => n + r.paid, 0)),
  };

  // ---- Best and slow sellers ----
  // Best: most units sold in the period. Slow: active products that sold least (or nothing), with the
  // last time each one sold and the money tied up in its stock.
  const bestSellers = [...products]
    .filter((p) => p.qty > 0)
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
    .slice(0, 10)
    .map((p) => ({ _id: p._id, name: p.name, qty: p.qty, revenue: round(p.revenue), profit: round(p.profit), stock: p.stock }));

  const lastSold = new Map(
    (
      await Sale.aggregate([
        { $match: { status: 'completed' } },
        { $project: { createdAt: 1, 'items.product': 1 } },
        { $unwind: '$items' },
        { $group: { _id: '$items.product', at: { $max: '$createdAt' } } },
      ])
    ).map((r) => [String(r._id), r.at])
  );
  const slowSellers = stock
    .filter((p) => p.active)
    .map((p) => {
      const at = lastSold.get(String(p._id)) || null;
      return { ...p, lastSoldAt: at, daysSinceSale: at ? Math.floor((Date.now() - new Date(at)) / 86400000) : null };
    })
    // fewest sold first; among equals, the most money tied up in stock first
    .sort((a, b) => a.sold - b.sold || b.costValue - a.costValue)
    .slice(0, 10);

  // ---- Outstanding debts ----
  const [supplierDebts, unpaidOrders] = await Promise.all([
    Purchase.aggregate([
      { $match: { status: { $ne: 'cancelled' } } },
      { $addFields: { balance: { $subtract: ['$receivedValue', '$amountPaid'] } } },
      { $match: { balance: { $gt: 0.004 } } },
      { $group: { _id: '$supplier', name: { $last: '$supplierName' }, owed: { $sum: '$balance' }, purchases: { $sum: 1 }, oldest: { $min: { $ifNull: [{ $min: '$deliveries.at' }, '$createdAt'] } } } },
      { $sort: { owed: -1 } },
    ]),
    Order.aggregate([
      { $match: { status: 'open' } },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$total' }, oldest: { $min: '$createdAt' } } },
    ]),
  ]);
  const debts = {
    owedToSuppliers: round(supplierDebts.reduce((n, d) => n + d.owed, 0)),
    suppliers: supplierDebts.map((d) => ({ ...d, owed: round(d.owed), daysOutstanding: Math.floor((Date.now() - new Date(d.oldest)) / 86400000) })),
    customerOrders: { count: unpaidOrders[0]?.count || 0, total: round(unpaidOrders[0]?.total), oldest: unpaidOrders[0]?.oldest || null },
  };

  // ---- Expenses (running costs) and net profit ----
  const expenseRows = await Expense.aggregate([
    { $match: { date: period } },
    { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort: { total: -1 } },
  ]);
  const expenseTotal = round(expenseRows.reduce((n, e) => n + e.total, 0));
  const expenses = {
    total: expenseTotal,
    byCategory: expenseRows.map((e) => ({ category: e._id, total: round(e.total), count: e.count, share: expenseTotal ? round((e.total / expenseTotal) * 100) : 0 })),
    netProfit: round(totals.profit - expenseTotal), // gross profit (sales − cost of goods) − running costs
    // all money paid out in the period: suppliers + running costs
    totalMoneyOut: round(purchaseTotals.paid + expenseTotal),
  };

  res.json({
    range: { from: match.createdAt.$gte, to: match.createdAt.$lte },
    bestSellers,
    slowSellers,
    debts,
    expenses,
    purchaseTotals,
    purchaseSuppliers,
    purchaseProducts: receivedByProduct.map((p) => ({ ...p, cost: round(p.cost), avgCost: round(p.avgCost) })),
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
