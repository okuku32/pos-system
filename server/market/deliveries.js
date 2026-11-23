// Delivery records (models/Delivery.js): one per store an order ships from. An order with items from two of the
// seller's stores has two deliveries (split fulfilment), each with its own status, rider and timestamps.
//   createFor(order)   made when the order is placed (and, for older orders, the first time they're looked at)
//   syncOrder(order)   the order moved on (shipped / delivered / cancelled): its deliveries follow
//   fromTask(task)     our rider's job moved on (accepted, picked up, on the way, delivered): its delivery follows
//   sellerUpdate       the seller sends a part themselves (packed → sent → delivered for cash orders)
//   received           the buyer got a part; when every part has arrived the order is delivered
const Delivery = require('../models/Delivery');
const Store = require('../models/Store');
const httpError = require('../utils/httpError');

const FINAL = ['delivered', 'cancelled'];
const OUR_TEAM = ['rider', 'courier', 'verified']; // delivered by our riders / agents (their jobs drive the status)
const keyOf = (item) => (item.store ? String(item.store) : 'none');

async function createFor(order) {
  if (await Delivery.exists({ order: order._id })) return Delivery.find({ order: order._id }).sort({ seq: 1 });
  const groups = new Map();
  for (const item of order.items || []) {
    if (!groups.has(keyOf(item))) groups.set(keyOf(item), []);
    groups.get(keyOf(item)).push(item);
  }
  const ids = [...groups.keys()].filter((key) => key !== 'none');
  const stores = new Map((await Store.find({ _id: { $in: ids } }).select('name area isMain').lean()).map((store) => [String(store._id), store]));
  // the main store's part first (our rider's first pickup, priced at checkout from the main shop)
  const keys = [...groups.keys()].sort((first, second) => (stores.get(second)?.isMain ? 1 : 0) - (stores.get(first)?.isMain ? 1 : 0));
  const docs = keys.map((key, index) => {
    const store = stores.get(key);
    return {
      order: order._id, orderNo: order.orderNo, seq: index + 1, of: keys.length, seller: order.seller, buyer: order.buyer,
      ...(store ? { store: store._id, storeName: store.name, storeArea: store.area } : {}),
      items: groups.get(key).map((item) => ({ listing: item.listing, title: item.title, qty: item.qty, image: item.image })),
      method: order.delivery?.method, status: order.status === 'cancelled' ? 'cancelled' : order.status === 'delivered' ? 'delivered' : 'pending',
      // the buyer paid for one delivery (the first); extra parts are the seller's cost
      fee: index === 0 ? order.deliveryFee || 0 : 0, paidBy: index === 0 ? (order.deliveryFee ? 'buyer' : 'none') : 'seller',
      history: [{ status: 'pending', by: 'system', note: keys.length > 1 ? `Part ${index + 1} of ${keys.length}${store ? `, from ${store.name}` : ''}` : undefined }],
    };
  });
  try {
    await Delivery.insertMany(docs, { ordered: false });
  } catch (error) {
    if (error.code !== 11000 && !error.writeErrors?.every((item) => item.code === 11000)) throw error; // made at the same moment elsewhere
  }
  return Delivery.find({ order: order._id }).sort({ seq: 1 });
}
const forOrder = (order) => createFor(order);

const move = (delivery, status, by, note) => {
  if (delivery.status === status) return false;
  delivery.status = status;
  if (status === 'ready') delivery.readyAt = delivery.readyAt || new Date();
  if (status === 'picked_up' || status === 'on_the_way') delivery.pickedUpAt = delivery.pickedUpAt || new Date();
  if (status === 'delivered') delivery.deliveredAt = new Date();
  delivery.history.push({ status, by, note: note || undefined });
  return true;
};

// the order moved on: its deliveries follow
async function syncOrder(order, next, by = 'system') {
  const list = await createFor(order);
  const changed = [];
  for (const delivery of list) {
    if (FINAL.includes(delivery.status)) continue;
    let moved = false;
    if (next === 'cancelled') moved = move(delivery, 'cancelled', by);
    else if (next === 'delivered') moved = move(delivery, 'delivered', by);
    else if (next === 'shipped' && !OUR_TEAM.includes(order.delivery?.method) && ['pending', 'ready'].includes(delivery.status)) moved = move(delivery, 'on_the_way', by, order.shipNote);
    if (moved) changed.push(delivery);
  }
  if (changed.length) await Delivery.bulkSave(changed); // one write
}

// our rider's job moved on: the delivery it belongs to follows
async function fromTask(task) {
  if (task.kind !== 'delivery' || !task.order) return;
  const delivery = task.delivery ? await Delivery.findById(task.delivery) : await Delivery.findOne({ order: task.order, seq: 1 });
  if (!delivery || FINAL.includes(delivery.status)) return;
  if (!delivery.task) delivery.task = task._id;
  delivery.riderName = task.workerName || delivery.riderName;
  delivery.riderPhone = task.workerPhone || delivery.riderPhone;
  const courierSent = task.courier?.company && task.status === 'done';
  const status = courierSent ? 'on_the_way'
    : ['delivered', 'done'].includes(task.status) ? 'delivered'
      : task.status === 'picked_up' ? (task.onTheWayAt ? 'on_the_way' : 'picked_up')
        : task.status === 'assigned' ? 'assigned'
          : 'ready'; // open (riders alerted) or given back
  move(delivery, status, 'rider', courierSent ? `Sent by ${task.courier.name}, waybill ${task.courier.waybill}` : task.status === 'assigned' ? task.workerName : undefined);
  if (task.fee && delivery.paidBy === 'seller') delivery.fee = task.fee;
  await delivery.save();
}
const fromTaskSoon = (task) => { fromTask(task).catch((error) => console.error('Delivery record:', error.message)); };

// the seller sends a part themselves (their own delivery person, walking, or the buyer collects it)
async function sellerUpdate(order, deliveryId, status, note) {
  if (OUR_TEAM.includes(order.delivery?.method)) throw httpError('Our team delivers this order: call a rider for each part', 409);
  if (!['confirmed', 'shipped'].includes(order.status)) throw httpError(order.status === 'placed' ? 'Confirm the order first' : `This order is already ${order.status}`, 409);
  if (!['ready', 'on_the_way', 'delivered'].includes(status)) throw httpError('Choose: packed, sent or delivered');
  if (status === 'delivered' && order.payment?.method === 'mpesa') throw httpError('The buyer confirms delivery of M-Pesa orders', 409);
  const delivery = await Delivery.findOne({ _id: deliveryId, order: order._id });
  if (!delivery) throw httpError('Delivery not found', 404);
  if (FINAL.includes(delivery.status)) throw httpError(`This part is already ${delivery.status}`, 409);
  const rank = { pending: 0, ready: 1, assigned: 1, picked_up: 2, on_the_way: 2, delivered: 3 };
  if (rank[status] < rank[delivery.status]) throw httpError('This part has already gone further than that', 409);
  move(delivery, status, 'seller', String(note || '').replace(/[<>]/g, '').slice(0, 200));
  if (note) delivery.note = String(note).replace(/[<>]/g, '').slice(0, 200);
  await delivery.save();
  return rollUp(order, 'seller');
}

// the buyer got a part
async function received(order, deliveryId) {
  if (!['confirmed', 'shipped'].includes(order.status)) throw httpError(`This order is ${order.status}`, 409);
  const delivery = await Delivery.findOne({ _id: deliveryId, order: order._id });
  if (!delivery) throw httpError('Delivery not found', 404);
  if (delivery.status === 'delivered') return rollUp(order, 'buyer');
  if (['pending', 'cancelled'].includes(delivery.status)) throw httpError('This part hasn’t been sent yet', 409);
  move(delivery, 'delivered', 'buyer');
  await delivery.save();
  if (delivery.task) {
    const Task = require('../models/Task');
    const task = await Task.findById(delivery.task);
    if (task && !['done', 'cancelled'].includes(task.status)) {
      task.buyerConfirmedAt = new Date();
      if (task.riderConfirmedAt) require('../controllers/workController').finishTask(task);
      await task.save();
    }
  }
  return rollUp(order, 'buyer');
}

// every part sent → the order is shipped; every part delivered → the order is delivered
async function rollUp(order, by) {
  const list = await Delivery.find({ order: order._id, status: { $ne: 'cancelled' } });
  const orders = require('../controllers/orderController');
  if (list.length && list.every((delivery) => delivery.status === 'delivered') && order.status !== 'delivered') {
    await orders.applyStatus(order, 'delivered', by, { note: list.length > 1 ? `All ${list.length} parts delivered` : undefined });
  } else if (order.status === 'confirmed' && list.length && list.every((delivery) => ['on_the_way', 'picked_up', 'delivered'].includes(delivery.status))) {
    await orders.applyStatus(order, 'shipped', by, { note: list.length > 1 ? `All ${list.length} parts sent` : list[0].note });
  } else orders.broadcast(order);
  return Delivery.find({ order: order._id }).sort({ seq: 1 }).lean();
}

const view = (delivery) => ({
  _id: delivery._id, seq: delivery.seq, of: delivery.of, status: delivery.status, method: delivery.method, store: delivery.store || null, storeName: delivery.storeName || '', storeArea: delivery.storeArea || '',
  items: delivery.items, fee: delivery.fee || 0, paidBy: delivery.paidBy, riderName: delivery.riderName || '', riderPhone: delivery.riderPhone || '', note: delivery.note || '', hasRider: !!delivery.task,
  readyAt: delivery.readyAt, pickedUpAt: delivery.pickedUpAt, deliveredAt: delivery.deliveredAt, history: delivery.history || [],
});

module.exports = { createFor, forOrder, syncOrder, fromTask, fromTaskSoon, sellerUpdate, received, rollUp, view, FINAL, OUR_TEAM };
