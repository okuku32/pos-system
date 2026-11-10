// Customer email notifications for online orders.
// Each kind is sent at most once per order: the flag is claimed atomically before sending.
const Order = require('../models/Order');
const Customer = require('../models/Customer');
const { sendMail } = require('./mailer');
const templates = require('./emailTemplates');

async function notifyOnce(orderId, kind, build) {
  // Claim the flag first, so two quick status changes can't send the same email twice
  const order = await Order.findOneAndUpdate(
    { _id: orderId, [`emailsSent.${kind}`]: { $ne: true } },
    { $set: { [`emailsSent.${kind}`]: true } },
    { returnDocument: 'after' }
  );
  if (!order || !order.customerAccount) return null; // already sent, or not an online customer order
  const customer = await Customer.findById(order.customerAccount);
  if (!customer?.email) return null;
  const mail = await build(order, customer);
  return sendMail({ to: customer.email, ...mail });
}

// Fire-and-forget wrappers: callers never wait for email or see email errors
const run = (p) => {
  p.catch((err) => console.error('[email] notification error:', err.message));
};

exports.orderPlaced = (orderId) => run(notifyOnce(orderId, 'placed', (o, c) => templates.orderPlaced(o, c)));
exports.paymentReceived = (orderId, sale) => run(notifyOnce(orderId, 'paid', (o, c) => templates.paymentReceived(o, c, sale)));
exports.stageChanged = (order) => {
  if (!order) return;
  if (order.stage === 'out-for-delivery') run(notifyOnce(order._id, 'dispatched', (o, c) => templates.dispatched(o, c)));
  if (order.stage === 'ready' && order.type === 'pickup') run(notifyOnce(order._id, 'ready', (o, c) => templates.readyForPickup(o, c)));
};
exports.cancelled = (orderId) => run(notifyOnce(orderId, 'cancelled', (o, c) => templates.cancelled(o, c)));

// Staff replied to a support conversation: email the customer if they left an email address
exports.supportReply = (thread, text, staffName) => {
  if (!thread?.customer?.email) return;
  run(sendMail({ to: thread.customer.email, ...templates.supportReply(thread, text, staffName) }));
};

// For tests / the admin "send test email" button: waits for the result
exports.sendTest = (to) => sendMail({ to, ...templates.test(to) });
