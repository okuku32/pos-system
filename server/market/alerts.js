// Live notifications for buyers and sellers, in English and Kiswahili:
//   · a buyer adds a seller's item to their cart → the seller hears about it (at most once per buyer & item every 10 minutes)
//   · an order is placed / confirmed / on the way / delivered / cancelled → the buyer and seller hear about it
const Notification = require('../models/Notification');
const { emitCustomer } = require('../utils/realtime');

const ksh = (amount) => `KSh ${Math.round(Number(amount) || 0).toLocaleString('en-KE')}`;
const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';

function view(request) {
  return { _id: request._id, kind: request.kind, icon: request.icon, title: request.title, body: request.body, link: request.link, read: request.read, createdAt: request.createdAt };
}

async function send(to, data) {
  const notification = await Notification.create({ to, ...data });
  emitCustomer(String(to), 'notify', view(notification));
  require('../utils/push').notify(to, data); // 📲 also to their phones (when push is set up)
  return notification;
}

// ---------------------------------------------------------------- "added to cart"
const recent = new Map(); // `${listing}:${who}` → time (in-memory throttle)
const GAP = 10 * 60 * 1000;
function throttled(key) {
  const now = Date.now();
  if (recent.size > 5000) for (const [entryKey, value] of recent) if (now - value > GAP) recent.delete(entryKey);
  if (now - (recent.get(key) || 0) < GAP) return true;
  recent.set(key, now);
  return false;
}

async function addedToCart({ listing, qty, buyer, who }) {
  if (!listing?.seller) return null;
  if (buyer && String(buyer._id) === String(listing.seller)) return null; // their own item
  if (throttled(`${listing._id}:${who}`)) return null;
  const name = buyer ? first(buyer.name) : '';
  const amount = Math.max(1, Math.min(9999, Math.floor(Number(qty)) || 1));
  const item = `${amount} × ${listing.title}`;
  return send(listing.seller, {
    kind: 'cart',
    icon: '🛒',
    listing: listing._id,
    link: `/market/item/${listing.slug}`,
    title: {
      en: name ? `${name} added your item to their cart` : 'A buyer added your item to their cart',
      sw: name ? `${name} ameweka bidhaa yako kwenye kikapu` : 'Mnunuzi ameweka bidhaa yako kwenye kikapu',
    },
    body: {
      en: `${item} (${ksh(listing.price * amount)}). Be ready: reply fast if they message you.`,
      sw: `${item} (${ksh(listing.price * amount)}). Jitayarishe: jibu haraka akikutumia ujumbe.`,
    },
  });
}

// ---------------------------------------------------------------- orders
const itemsText = (order) => `${order.items[0]?.qty || 1} × ${order.items[0]?.title || ''}${order.items.length > 1 ? ` + ${order.items.length - 1}` : ''}`;

function orderMessages(order) {
  const no = order.orderNo;
  const pickup = order.delivery?.method === 'pickup';
  const buyerLink = `/orders/${order._id}`;
  const sellerLink = `/sales/${order._id}`;
  const cod = order.payment?.method === 'cod';
  const payEn = cod && order.sellerPay?.text ? ` Pay on delivery: ${order.sellerPay.text}.` : order.payOnDelivery ? ` Pay ${ksh(order.payOnDelivery)} delivery fee in cash when it arrives.` : '';
  const paySw = cod && order.sellerPay?.text ? ` Lipa ukipokea: ${order.sellerPay.text}.` : order.payOnDelivery ? ` Lipa ${ksh(order.payOnDelivery)} ya usafiri kwa pesa taslimu ukipokea.` : '';
  const why = order.cancelReason ? `: ${order.cancelReason}` : '';
  switch (order.status) {
    case 'placed':
      return [
        { to: order.seller, icon: '🛍️', link: sellerLink,
          title: { en: `New order ${no}`, sw: `Oda mpya ${no}` },
          body: { en: `${first(order.buyerName) || 'A buyer'} ordered ${itemsText(order)}, ${ksh(order.total)}${cod ? ' (pay on delivery)' : ' (paid with M-Pesa)'}. Confirm it now.`, sw: `${first(order.buyerName) || 'Mnunuzi'} ameagiza ${itemsText(order)}, ${ksh(order.total)}${cod ? ' (atalipa akipokea)' : ' (amelipa kwa M-Pesa)'}. Ithibitishe sasa.` } },
        { to: order.buyer, icon: '✅', link: buyerLink,
          title: { en: `Order ${no} placed`, sw: `Oda ${no} imetumwa` },
          body: { en: `${order.sellerName} will confirm it shortly.${payEn}`, sw: `${order.sellerName} ataithibitisha hivi karibuni.${paySw}` } },
      ];
    case 'confirmed':
      return [{ to: order.buyer, icon: '👍', link: buyerLink,
        title: { en: `Order ${no} confirmed`, sw: `Oda ${no} imethibitishwa` },
        body: { en: `${order.sellerName} confirmed your order and is getting it ready.${payEn}`, sw: `${order.sellerName} amethibitisha oda yako na anaitayarisha.${paySw}` } }];
    case 'shipped':
      return [{ to: order.buyer, icon: pickup ? '📍' : '🚚', link: buyerLink,
        title: pickup ? { en: `Order ${no} is ready for pickup`, sw: `Oda ${no} iko tayari kuchukuliwa` } : { en: `Order ${no} is on the way`, sw: `Oda ${no} iko njiani` },
        body: pickup
          ? { en: `Collect it from ${order.sellerName}.${payEn}`, sw: `Ichukue kwa ${order.sellerName}.${paySw}` }
          : order.delivery?.method === 'courier'
            ? { en: `Our agent is taking it to ${order.rider?.courier?.name || 'the courier'}. You’ll get the waybill number here.`, sw: `Wakala wetu anaipeleka kwa ${order.rider?.courier?.name || 'kampuni ya usafirishaji'}. Utapata nambari ya kifurushi hapa.` }
            : { en: `Check the items when they arrive, then confirm you got them.${payEn}`, sw: `Kagua bidhaa zikifika, kisha thibitisha umezipokea.${paySw}` } }];
    case 'delivered':
      return [
        { to: order.buyer, icon: '🎉', link: buyerLink,
          title: { en: `Order ${no} delivered`, sw: `Oda ${no} imefika` },
          body: { en: `Enjoy! Rate ${order.sellerName} to help other buyers.`, sw: `Furahia! Mpe ${order.sellerName} alama kuwasaidia wanunuzi wengine.` } },
        { to: order.seller, icon: '🎉', link: sellerLink,
          title: { en: `Order ${no} delivered`, sw: `Oda ${no} imefika kwa mnunuzi` },
          body: { en: `Well done! ${order.payment?.method === 'mpesa' ? 'Your payout is on its way.' : 'Make sure you were paid.'}`, sw: `Hongera! ${order.payment?.method === 'mpesa' ? 'Malipo yako yanakuja.' : 'Hakikisha umelipwa.'}` } },
      ];
    case 'cancelled':
      // an unpaid M-Pesa order that expired: the seller never saw it, so only the buyer hears
      return (order.history?.some((height) => height.status === 'placed') ? [order.buyer, order.seller] : [order.buyer]).map((to) => ({ to, icon: '❌', link: String(to) === String(order.buyer) ? buyerLink : sellerLink,
        title: { en: `Order ${no} cancelled`, sw: `Oda ${no} imeghairiwa` },
        body: { en: `Cancelled${order.cancelledBy ? ` by the ${order.cancelledBy}` : ''}${why}.${order.payment?.status === 'refund_due' ? ' Your refund is on its way.' : ''}`, sw: `Imeghairiwa${order.cancelledBy ? ` na ${{ buyer: 'mnunuzi', seller: 'muuzaji', admin: 'timu yetu', system: 'mfumo' }[order.cancelledBy] || order.cancelledBy}` : ''}${why}.${order.payment?.status === 'refund_due' ? ' Pesa yako itarudishwa.' : ''}` } }));
    default:
      return [];
  }
}

// called every time an order changes: each status is announced once
async function orderChanged(order) {
  if (!order?._id || !['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'].includes(order.status)) return;
  const Order = require('../models/Order');
  const claimed = await Order.updateOne({ _id: order._id, notifiedStatus: { $ne: order.status } }, { $set: { notifiedStatus: order.status } });
  if (!claimed.modifiedCount) return;
  for (const orderMessage of orderMessages(order)) await send(orderMessage.to, { kind: 'order', order: order._id, ...orderMessage });
}

// the agent handed the parcel to the courier: the buyer gets the waybill
async function courierSent(order) {
  const courier = order.rider?.courier;
  if (!courier?.waybill) return null;
  const town = order.delivery?.county || 'your town';
  return send(order.buyer, {
    kind: 'order', icon: '📦', order: order._id, link: `/orders/${order._id}`,
    title: { en: `Order ${order.orderNo} sent by ${courier.name}`, sw: `Oda ${order.orderNo} imetumwa kupitia ${courier.name}` },
    body: {
      en: `Waybill ${courier.waybill}. Collect it at the ${courier.name} office in ${town}${courier.eta ? ` (${courier.eta.toLowerCase()})` : ''}. Bring your ID, then confirm you got it.`,
      sw: `Nambari ya kifurushi: ${courier.waybill}. Kichukue kwenye ofisi ya ${courier.name} ${town}. Beba kitambulisho chako, kisha thibitisha umekipokea.`,
    },
  });
}

// the seller's money is released before delivery (our team checked / collected the goods)
async function sellerPaidEarly(order) {
  return send(order.seller, {
    kind: 'order', icon: '💰', order: order._id, link: `/sales/${order._id}`,
    title: { en: `Payment released: order ${order.orderNo}`, sw: `Malipo yametolewa: oda ${order.orderNo}` },
    body: {
      en: `${ksh(order.payout.amount)} is on its way to you. Our team has your goods, so you don’t wait for delivery.`,
      sw: `${ksh(order.payout.amount)} yanakujia. Timu yetu imechukua bidhaa zako, hivyo husubiri uwasilishaji.`,
    },
  });
}

// our rider is on the way / has arrived (the buyer is told live)
async function riderStage(order, stage) {
  const name = first(order.rider?.name) || 'Your rider';
  const words = stage === 'arrived'
    ? { icon: '📍', title: { en: `${name} has arrived with order ${order.orderNo}`, sw: `${name} amefika na oda ${order.orderNo}` }, body: { en: 'Please meet them. Check your items, then confirm you received them.', sw: 'Tafadhali mpokee. Kagua bidhaa zako, kisha thibitisha umepokea.' } }
    : { icon: '🛵', title: { en: `${name} is on the way with order ${order.orderNo}`, sw: `${name} yuko njiani na oda ${order.orderNo}` }, body: { en: 'Keep your phone near: they’ll call when they’re close.', sw: 'Weka simu karibu: atakupigia akikaribia.' } };
  return send(order.buyer, { kind: 'order', order: order._id, link: `/orders/${order._id}`, ...words });
}

module.exports = { send, riderStage, addedToCart, orderChanged, orderMessages, view, courierSent, sellerPaidEarly };
