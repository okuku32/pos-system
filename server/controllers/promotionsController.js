// Admin → Promotions: what sellers pay us to boost their ads ("Featured"), by day, week or month.
const asyncHandler = require('../utils/asyncHandler');
const Boost = require('../models/Boost');
const Customer = require('../models/Customer');
const { ALL_PLANS: BOOST_PLANS } = require('./boostController');

const TZ = 'Africa/Nairobi';
const DAY = 86400000;
// when a boost was paid (older ones: when they were last updated, i.e. settled)
const PAID_AT = { $ifNull: ['$paidAt', '$updatedAt'] };

// Kenya-time calendar helpers (Kenya is UTC+3 all year)
const kenya = (date) => new Date(date.getTime() + 3 * 3600000);
const fromKenya = (currentKenya, match, day) => new Date(Date.UTC(currentKenya, match, day) - 3 * 3600000);
function startOf(unit, date = new Date()) {
  const when = kenya(date);
  if (unit === 'month') return fromKenya(when.getUTCFullYear(), when.getUTCMonth(), 1);
  const day = fromKenya(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate());
  if (unit === 'week') return new Date(day.getTime() - ((when.getUTCDay() + 6) % 7) * DAY); // Monday
  return day;
}
function next(unit, date) {
  if (unit === 'month') {
    const kenyaResult = kenya(date);
    return fromKenya(kenyaResult.getUTCFullYear(), kenyaResult.getUTCMonth() + 1, 1);
  }
  return new Date(date.getTime() + (unit === 'week' ? 7 : 1) * DAY);
}
function labelOf(unit, date) {
  const day = kenya(date);
  const opts = { timeZone: 'UTC' };
  if (unit === 'month') return day.toLocaleDateString('en-GB', { ...opts, month: 'short', year: 'numeric' });
  if (unit === 'week') {
    const end = kenya(new Date(date.getTime() + 6 * DAY));
    return `${day.toLocaleDateString('en-GB', { ...opts, day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-GB', { ...opts, day: 'numeric', month: 'short' })}`;
  }
  return day.toLocaleDateString('en-GB', { ...opts, weekday: 'short', day: 'numeric', month: 'short' });
}
const SPAN = { day: 30, week: 12, month: 12 }; // how many periods to show

// GET /api/admin/promotions?group=day|week|month[&from=YYYY-MM-DD&to=YYYY-MM-DD]
exports.report = asyncHandler(async (req, res) => {
  const unit = ['day', 'week', 'month'].includes(req.query.group) ? req.query.group : 'day';
  const day = (date) => (/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? new Date(`${date}T00:00:00+03:00`) : null);
  const end = day(req.query.to) ? next('day', day(req.query.to)) : next(unit, startOf(unit));
  let from = day(req.query.from) ? startOf(unit, day(req.query.from)) : startOf(unit);
  if (!day(req.query.from)) for (let index = 1; index < SPAN[unit]; index++) from = startOf(unit, new Date(from.getTime() - DAY)); // back n periods
  const now = new Date();
  const paid = { status: 'paid' };
  const inRange = { $expr: { $and: [{ $gte: [PAID_AT, from] }, { $lt: [PAID_AT, end] }] } };

  const [series, byPlan, top, payments, cards, counts, activeNow] = await Promise.all([
    Boost.aggregate([
      { $match: { ...paid, ...inRange } },
      { $group: { _id: { $dateTrunc: { date: PAID_AT, unit, timezone: TZ, ...(unit === 'week' ? { startOfWeek: 'monday' } : {}) } }, revenue: { $sum: '$amount' }, boosts: { $sum: 1 }, sellers: { $addToSet: '$seller' } } },
    ]),
    Boost.aggregate([{ $match: { ...paid, ...inRange } }, { $group: { _id: '$plan', boosts: { $sum: 1 }, revenue: { $sum: '$amount' } } }]),
    Boost.aggregate([
      { $match: { ...paid, ...inRange } },
      { $group: { _id: '$seller', boosts: { $sum: 1 }, revenue: { $sum: '$amount' }, ads: { $addToSet: '$listing' }, last: { $max: PAID_AT } } },
      { $sort: { revenue: -1, last: -1 } },
      { $limit: 20 },
    ]),
    Boost.find({ ...paid, ...inRange }).sort({ paidAt: -1, updatedAt: -1 }).limit(200).select('seller listing listingTitle plan days amount receipt phone startsAt endsAt paidAt updatedAt').lean(),
    // the cards: today, this week, this month, all time (whatever period is shown)
    (async () => {
      const periods = [['today', startOf('day')], ['week', startOf('week')], ['month', startOf('month')], ['all', null]];
      const sums = Object.fromEntries(periods.flatMap(([key, since]) => [
        [`${key}Revenue`, { $sum: since ? { $cond: [{ $gte: [PAID_AT, since] }, '$amount', 0] } : '$amount' }],
        [`${key}Boosts`, { $sum: since ? { $cond: [{ $gte: [PAID_AT, since] }, 1, 0] } : 1 }],
      ]));
      const [row] = await Boost.aggregate([{ $match: paid }, { $group: { _id: null, ...sums } }]); // one pass for all four
      return periods.map(([key]) => [key, { revenue: row?.[`${key}Revenue`] || 0, boosts: row?.[`${key}Boosts`] || 0 }]);
    })(),
    Boost.aggregate([{ $match: { status: { $in: ['pending', 'failed'] }, createdAt: { $gte: from, $lt: end } } }, { $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
    Boost.countDocuments({ ...paid, endsAt: { $gt: now }, startsAt: { $lte: now } }),
  ]);

  // every period in the range, including empty ones
  const by = new Map(series.map((seriesItem) => [seriesItem._id.getTime(), seriesItem]));
  const out = [];
  for (let date = from; date < end; date = next(unit, date)) {
    const text = by.get(date.getTime());
    out.push({ start: date, label: labelOf(unit, date), revenue: text?.revenue || 0, boosts: text?.boosts || 0, sellers: text?.sellers.length || 0, current: date <= now && now < next(unit, date) });
  }
  const sellerIds = [...new Set([...top.map((item) => String(item._id)), ...payments.map((payment) => String(payment.seller))])];
  const people = new Map((await Customer.find({ _id: { $in: sellerIds } }).select('name phone shopLocation.name').lean()).map((item) => [String(item._id), item]));
  const total = out.reduce((sum, item) => ({ revenue: sum.revenue + item.revenue, boosts: sum.boosts + item.boosts }), { revenue: 0, boosts: 0 });
  const sellersInRange = new Set(series.flatMap((seriesItem) => seriesItem.sellers.map(String))).size;
  const statusOf = (key) => counts.find((count) => count._id === key) || { n: 0, amount: 0 };
  res.json({
    group: unit, from, to: end,
    cards: Object.fromEntries(cards),
    totals: { ...total, sellers: sellersInRange, average: total.boosts ? Math.round(total.revenue / total.boosts) : 0, best: out.reduce((sum, item) => (item.revenue > (sum?.revenue || 0) ? item : sum), null) },
    series: out,
    byPlan: Object.entries(BOOST_PLANS).map(([key, value]) => {
      const result = byPlan.find((item) => item._id === key);
      return { plan: key, label: value.label, days: value.days, price: value.amount, boosts: result?.boosts || 0, revenue: result?.revenue || 0 };
    }),
    topSellers: top.map((item) => {
      const person = people.get(String(item._id)) || {};
      return { seller: item._id, name: person.name || '(removed)', shop: person.shopLocation?.name || '', phone: person.phone || '', boosts: item.boosts, ads: item.ads.length, revenue: item.revenue, last: item.last };
    }),
    payments: payments.map((payment) => {
      const person = people.get(String(payment.seller)) || {};
      return { _id: payment._id, at: payment.paidAt || payment.updatedAt, seller: payment.seller, name: person.name || '', shop: person.shopLocation?.name || '', listing: payment.listing, title: payment.listingTitle, plan: BOOST_PLANS[payment.plan]?.label || payment.plan, days: payment.days, amount: payment.amount, receipt: payment.receipt || '', endsAt: payment.endsAt, live: payment.endsAt > now && payment.startsAt <= now };
    }),
    pending: statusOf('pending'), failed: statusOf('failed'), activeNow,
  });
});
