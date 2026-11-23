// Where a delivery is right now, in five steps the buyer understands:
//   📦 Packed → 🚚 Dispatched → 🛵 On the way → 📍 Arrived → ✅ Delivered
// For orders delivered by our riders / on-foot delivery agents (and the shop's own walking delivery, courier and
// Safe deal), and for errands booked directly (parcels, "shop for me").
const STEPS = [
  ['packed', 'Packed', '📦'],
  ['dispatched', 'Dispatched', '🚚'],
  ['on_the_way', 'On the way', '🛵'],
  ['arrived', 'Arrived', '📍'],
  ['delivered', 'Delivered', '✅'],
];
const DELIVERED_BY_US = ['rider', 'walk', 'courier', 'verified'];

const firstAt = (history, ...statuses) => (history || []).find((entry) => statuses.includes(entry.status))?.at || null;

// [{ key, label, icon, at, done }] + the current step
function build(times, extra = {}) {
  let reached = -1;
  STEPS.forEach(([key], index) => { if (times[key]) reached = index; });
  const steps = STEPS.map(([key, label, icon], index) => ({ key, label, icon, at: times[key] || null, done: index <= reached, ...(extra[key] ? { note: extra[key] } : {}) }));
  return { steps, current: reached >= 0 ? STEPS[reached][0] : 'waiting', currentLabel: reached >= 0 ? STEPS[reached][1] : 'Waiting for the seller' };
}

function forOrder(order) {
  const method = order.delivery?.method;
  if (!DELIVERED_BY_US.includes(method) || order.status === 'awaiting_payment') return null;
  const rider = order.rider || {};
  const history = order.history || [];
  const delivered = order.status === 'delivered' ? firstAt(history, 'delivered') || order.updatedAt : null;
  const confirmed = firstAt(history, 'confirmed');
  // packed: the seller confirmed and got it ready (Safe deal: verified at the partner shop)
  const packed = method === 'verified' ? order.verification?.verifiedAt || null : confirmed;
  const shipped = firstAt(history, 'shipped');
  const dispatched = rider.pickedUpAt || shipped;
  // the shop's own walking delivery goes straight to the buyer once sent; courier: "on the way" once the bus has it
  const onTheWay = rider.onTheWayAt || (method === 'walk' ? shipped : method === 'courier' ? rider.courier?.sentAt : null);
  const arrived = rider.arrivedAt || null;
  const times = { packed, dispatched, on_the_way: onTheWay, arrived, delivered };
  // a later step implies the earlier ones happened (a rider who skipped "on my way")
  const order5 = ['packed', 'dispatched', 'on_the_way', 'arrived', 'delivered'];
  for (let index = order5.length - 1; index > 0; index--) if (times[order5[index]] && !times[order5[index - 1]]) times[order5[index - 1]] = times[order5[index]];
  const result = build(times, method === 'courier' ? { arrived: 'At the courier’s office in your town' } : {});
  return order.status === 'cancelled' ? { ...result, current: 'cancelled', currentLabel: 'Cancelled' } : result;
}

function forErrand(errand) {
  if (['awaiting_payment'].includes(errand.status)) return null;
  const history = errand.history || [];
  const times = {
    packed: firstAt(history, 'assigned'), // a rider / agent took it and is heading to the pick-up (or the shop)
    dispatched: firstAt(history, 'picked_up'),
    on_the_way: firstAt(history, 'on_the_way'),
    arrived: firstAt(history, 'arrived'),
    delivered: firstAt(history, 'delivered', 'done'),
  };
  const order5 = ['packed', 'dispatched', 'on_the_way', 'arrived', 'delivered'];
  for (let index = order5.length - 1; index > 0; index--) if (times[order5[index]] && !times[order5[index - 1]]) times[order5[index - 1]] = times[order5[index]];
  const result = build(times, { packed: errand.kind === 'shopping' ? 'Agent heading to the shop' : 'Rider heading to the pick-up' });
  return errand.status === 'cancelled' ? { ...result, current: 'cancelled', currentLabel: 'Cancelled' } : result;
}

module.exports = { STEPS, DELIVERED_BY_US, forOrder, forErrand };
