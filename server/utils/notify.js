// Email notifications for marketplace orders. Each kind is sent at most once per order:
// the flag is claimed atomically before sending, so two quick updates can't send the same email twice.
const Order = require('../models/Order');
const { sendMail } = require('./mailer');
const templates = require('./emailTemplates');

const isDemo = (email) => /\.test$/i.test(email || ''); // demo accounts: never email
const run = (value) => {
  value.catch((err) => console.error('[email] notification error:', err.message));
};

async function once(orderId, kind, to, build) {
  const order = await Order.findOneAndUpdate(
    { _id: orderId, [`emailsSent.${kind}`]: { $ne: true } },
    { $set: { [`emailsSent.${kind}`]: true } },
    { returnDocument: 'after' }
  ).lean();
  if (!order) return null;
  const address = to === 'buyer' ? order.buyerEmail : await sellerEmail(order.seller);
  if (!address || isDemo(address)) return null;
  return sendMail({ to: address, ...build(order) });
}
async function sellerEmail(id) {
  const Customer = require('../models/Customer');
  return (await Customer.findById(id).select('email').lean())?.email;
}

// order is now "placed" (cash on delivery straight away, M-Pesa once paid)
exports.orderPlaced = (order) => {
  run(once(order._id, 'placed', 'buyer', templates.orderPlaced));
  run(once(order._id, 'newSale', 'seller', templates.newSale));
};
exports.paymentReceived = (order) => run(once(order._id, 'paid', 'buyer', templates.paymentReceived));
exports.shipped = (order) => run(once(order._id, 'shipped', 'buyer', templates.shipped));
exports.delivered = (order) => run(once(order._id, 'delivered', 'buyer', templates.delivered));
exports.cancelled = (order) => {
  if (order.cancelledBy !== 'buyer') run(once(order._id, 'cancelled', 'buyer', templates.cancelled));
  if (order.cancelledBy !== 'seller' && order.status !== 'awaiting_payment' && order.history?.some((height) => height.status === 'placed')) run(once(order._id, 'saleCancelled', 'seller', templates.saleCancelled));
};

// Staff replied to a support conversation: email the customer if they left an email address
exports.supportReply = (thread, text, staffName) => {
  if (!thread?.customer?.email || isDemo(thread.customer.email)) return;
  run(sendMail({ to: thread.customer.email, ...templates.supportReply(thread, text, staffName) }));
};

// For the admin "send test email" button: waits for the result
exports.sendTest = (to) => require('./mailer').sendMailNow({ to, ...templates.test(to) }); // admin test: right now, with the result
