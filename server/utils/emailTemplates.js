// Branded marketplace emails. Table-based layout with inline styles so they render in Gmail, Outlook and phone mail apps.
const BRAND = '#ff5a1f';
const INK = '#14171f';
const MUTED = '#6b7280';

const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (match) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match]));
const ksh = (amount) => 'KSh ' + Number(amount || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 });
const first = (name = '') => String(name).trim().split(/\s+/)[0] || 'there';
const input = () => {
  try {
    return require('../config/site').site();
  } catch {
    return { name: 'Kapu', address: '', url: process.env.SHOP_URL || 'http://localhost:5173' };
  }
};
const NAME = () => input().name;
const URL_ = () => input().url;
// "Wed, 11 Nov 2026 at 2:35 pm" in Kenyan time
const when = (date) => {
  const dt = new Date(date || Date.now());
  const day = dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' });
  const text = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' }).toLowerCase();
  return `${day} at ${text}`;
};
const orderUrl = (order) => `${URL_()}/orders/${order._id}`;
const saleUrl = (order) => `${URL_()}/sales/${order._id}`;

function itemsTable(order) {
  const rows = order.items
    .map((item) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #f0ece6;color:${INK};font-size:14px;">${esc(item.qty)} × ${esc(item.title)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f0ece6;color:${INK};font-size:14px;text-align:right;white-space:nowrap;">${ksh(item.subtotal)}</td>
      </tr>`)
    .join('');
  const fee = order.deliveryFee > 0 ? `<tr><td style="padding:8px 0 0;color:${MUTED};font-size:14px;">Delivery</td><td style="padding:8px 0 0;color:${MUTED};font-size:14px;text-align:right;">${ksh(order.deliveryFee)}</td></tr>` : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">
      ${rows}${fee}
      <tr><td style="padding:12px 0 0;font-weight:800;font-size:16px;color:${INK};">Total</td>
          <td style="padding:12px 0 0;font-weight:800;font-size:16px;color:${INK};text-align:right;">${ksh(order.total)}</td></tr>
    </table>`;
}

function infoRows(rows) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;border-radius:12px;margin:16px 0;">
    ${rows.filter(Boolean).map(([key, value]) => `<tr>
      <td style="padding:10px 16px;color:${MUTED};font-size:13px;width:40%;">${esc(key)}</td>
      <td style="padding:10px 16px;color:${INK};font-size:14px;font-weight:600;">${esc(value)}</td></tr>`).join('')}
  </table>`;
}

function layout({ preheader, icon, title, intro, body, cta }) {
  const inputResult = input();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ec;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;">
        <tr><td style="background:${BRAND};padding:22px 28px;">
          <span style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;background:#ffffff;border-radius:10px;font-size:18px;vertical-align:middle;">🛍️</span>
          <span style="font-size:22px;font-weight:800;color:#ffffff;vertical-align:middle;margin-left:8px;letter-spacing:-0.5px;">${esc(inputResult.name)}</span>
        </td></tr>
        <tr><td style="padding:30px 28px 8px;">
          <div style="font-size:40px;line-height:1;margin-bottom:14px;">${icon}</div>
          <h1 style="margin:0 0 10px;font-size:24px;line-height:1.25;color:${INK};letter-spacing:-0.5px;">${esc(title)}</h1>
          <p style="margin:0;font-size:15px;line-height:1.6;color:#3b4252;">${intro}</p>
        </td></tr>
        <tr><td style="padding:8px 28px 4px;">${body}</td></tr>
        ${cta ? `<tr><td align="center" style="padding:18px 28px 30px;">
          <a href="${esc(cta.href)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:999px;">${esc(cta.label)}</a>
        </td></tr>` : ''}
        <tr><td style="padding:18px 28px 26px;border-top:1px solid #f0ece6;color:${MUTED};font-size:12px;line-height:1.6;text-align:center;">
          ${esc(inputResult.name)}: buy and sell anything in Kenya.<br>
          ${inputResult.address ? `📍 ${esc(inputResult.address)}` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const deliveryLine = (order) => (order.delivery?.method === 'walk' ? `Walking delivery (${order.delivery.km} km, about ${order.delivery.minutes} min) to ${order.delivery.address}` : order.delivery?.method === 'pickup' ? `Pick up from the seller in ${order.delivery.pickupArea || 'their area'}` : `Deliver to ${[order.delivery?.address, order.delivery?.county].filter(Boolean).join(', ')}`);
const codPay = (order) => `On delivery: ${order.sellerPay?.text ? `pay ${ksh(order.total - (order.delivery?.method === 'rider' ? order.deliveryFee || 0 : 0))} by ${order.sellerPay.text}` : `pay ${ksh(order.total)} cash or M-Pesa to the seller`}${order.delivery?.method === 'rider' && order.deliveryFee ? `, plus ${ksh(order.deliveryFee)} delivery fee in cash to our rider` : ''}`;
const payLine = (order) => (order.payment?.method === 'cod' ? codPay(order) : order.payment?.status === 'paid' ? `M-Pesa (paid${order.payment.receipt ? `, ${order.payment.receipt}` : ''})` : 'M-Pesa');
const textItems = (order) => order.items.map((item) => `  ${item.qty} x ${item.title}  ${ksh(item.subtotal)}`).join('\n') + (order.deliveryFee ? `\n  Delivery: ${ksh(order.deliveryFee)}` : '') + `\n  Total: ${ksh(order.total)}`;

// ---------------------------------------------------------------- buyer emails
exports.orderPlaced = (order) => ({
  subject: `Order ${order.orderNo} received: ${order.items[0]?.title}${order.items.length > 1 ? ` + ${order.items.length - 1} more` : ''}`,
  html: layout({
    preheader: `Your order from ${order.sellerName} is placed. ${ksh(order.total)}`,
    icon: '🧾',
    title: `Asante, ${first(order.buyerName)}! Your order is placed`,
    intro: `Order <b>${esc(order.orderNo)}</b> from <b>${esc(order.sellerName)}</b>, placed on ${esc(when(order.createdAt))}. The seller will confirm it shortly.`,
    body: itemsTable(order) + infoRows([['Order', order.orderNo], ['Seller', order.sellerName], ['Delivery', deliveryLine(order)], ['Payment', payLine(order)]]),
    cta: { href: orderUrl(order), label: 'Track your order' },
  }),
  text: `Asante, ${first(order.buyerName)}! Order ${order.orderNo} from ${order.sellerName} is placed (${when(order.createdAt)}).\n\n${textItems(order)}\n\n${deliveryLine(order)}\nPayment: ${payLine(order)}\n\nTrack it: ${orderUrl(order)}`,
});

exports.paymentReceived = (order) => ({
  subject: `Payment received for order ${order.orderNo}`,
  html: layout({
    preheader: `${ksh(order.total)} paid with M-Pesa`,
    icon: '✅',
    title: 'Payment received',
    intro: `We’ve received your M-Pesa payment for order <b>${esc(order.orderNo)}</b> (ordered ${esc(when(order.createdAt))}). ${esc(order.sellerName)} has been told to prepare it.`,
    body: infoRows([['Payment ID', order.payment?.ref || '–'], ['Amount', ksh(order.total - (order.payOnDelivery || 0))], ['Paid to', order.payment?.direct ? order.payment.to?.text || order.sellerName : 'Kapu (held until delivery)'], ['M-Pesa reference', order.payment?.receipt || '–'], ['Paid on', when(order.payment?.paidAt)]]) + itemsTable(order),
    cta: { href: orderUrl(order), label: 'View your order' },
  }),
  text: `Payment of ${ksh(order.total - (order.payOnDelivery || 0))} received for order ${order.orderNo}. Payment ID: ${order.payment?.ref || '-'}. M-Pesa reference: ${order.payment?.receipt || '-'}.\n\n${orderUrl(order)}`,
});

exports.shipped = (order) => ({
  subject: order.delivery?.method === 'pickup' ? `Order ${order.orderNo} is ready for pickup` : `Order ${order.orderNo} is on the way 🚚`,
  html: layout({
    preheader: order.delivery?.method === 'pickup' ? 'Your order is ready to collect' : 'Your order has been dispatched',
    icon: order.delivery?.method === 'pickup' ? '📦' : '🚚',
    title: order.delivery?.method === 'pickup' ? 'Ready for pickup' : 'Your order is on the way',
    intro: `${esc(order.sellerName)} has ${order.delivery?.method === 'pickup' ? 'your order ready' : 'sent your order'} <b>${esc(order.orderNo)}</b> (placed ${esc(when(order.createdAt))}).`,
    body: infoRows([['Delivery', deliveryLine(order)], order.shipNote && ['Note from the seller', order.shipNote], ['To pay', order.payment?.method === 'cod' ? codPay(order) : 'Already paid (M-Pesa)']]),
    cta: { href: orderUrl(order), label: 'Track your order' },
  }),
  text: `Order ${order.orderNo} from ${order.sellerName}: ${order.delivery?.method === 'pickup' ? 'ready for pickup' : 'on the way'}.${order.shipNote ? `\nNote: ${order.shipNote}` : ''}\n\n${orderUrl(order)}`,
});

exports.delivered = (order) => ({
  subject: `Order ${order.orderNo} delivered`,
  html: layout({
    preheader: 'Thanks for buying on the marketplace',
    icon: '🎉',
    title: 'Delivered. Enjoy!',
    intro: `Order <b>${esc(order.orderNo)}</b> from ${esc(order.sellerName)} is marked as delivered. Thank you for buying on ${esc(NAME())}!`,
    body: itemsTable(order) + `<p style="margin:12px 0 0;color:${MUTED};font-size:13px;">Something wrong with your order? Reply from the order page and our team will help.</p>`,
    cta: { href: orderUrl(order), label: 'View order' },
  }),
  text: `Order ${order.orderNo} from ${order.sellerName} was delivered. Thank you for buying on ${NAME()}!\n\n${orderUrl(order)}`,
});

exports.cancelled = (order) => ({
  subject: `Order ${order.orderNo} was cancelled`,
  html: layout({
    preheader: order.cancelReason || 'Your order was cancelled',
    icon: '✖️',
    title: 'Order cancelled',
    intro: `Order <b>${esc(order.orderNo)}</b> from ${esc(order.sellerName)} (placed ${esc(when(order.createdAt))}) was cancelled${order.cancelledBy === 'seller' ? ' by the seller' : order.cancelledBy === 'admin' ? ' by our team' : ''}.`,
    body: infoRows([order.cancelReason && ['Reason', order.cancelReason], ['Payment', order.payment?.status === 'refund_due' ? 'Your M-Pesa payment will be refunded' : 'You were not charged']]),
    cta: { href: `${URL_()}/`, label: 'Keep shopping' },
  }),
  text: `Order ${order.orderNo} from ${order.sellerName} was cancelled.${order.cancelReason ? ` Reason: ${order.cancelReason}.` : ''} ${order.payment?.status === 'refund_due' ? 'Your M-Pesa payment will be refunded.' : 'You were not charged.'}`,
});

// ---------------------------------------------------------------- seller emails
exports.newSale = (order) => ({
  subject: `🛒 New order ${order.orderNo}: ${order.items[0]?.title}${order.items.length > 1 ? ` + ${order.items.length - 1} more` : ''}`,
  html: layout({
    preheader: `${order.buyerName} ordered ${ksh(order.total)}`,
    icon: '🛒',
    title: 'You have a new order!',
    intro: `<b>${esc(order.buyerName)}</b> ordered from you on ${esc(when(order.createdAt))}. Please confirm it and get it ready.`,
    body: itemsTable(order) + infoRows([['Order', order.orderNo], ['Delivery', deliveryLine(order)], ['Buyer phone', order.buyerPhone || '–'], ['Payment', order.payment?.method === 'cod' ? `Collect ${ksh(order.total)} cash on delivery` : 'Paid with M-Pesa to the marketplace. We pay you after delivery.']]),
    cta: { href: saleUrl(order), label: 'Confirm the order' },
  }),
  text: `New order ${order.orderNo} from ${order.buyerName} (${order.buyerPhone || ''}).\n\n${textItems(order)}\n\n${deliveryLine(order)}\nPayment: ${order.payment?.method === 'cod' ? 'cash on delivery' : 'paid with M-Pesa'}\n\nConfirm it: ${saleUrl(order)}`,
});

exports.saleCancelled = (order) => ({
  subject: `Order ${order.orderNo} was cancelled by the buyer`,
  html: layout({
    preheader: 'No need to send this order',
    icon: '✖️',
    title: 'An order was cancelled',
    intro: `${esc(order.buyerName)} cancelled order <b>${esc(order.orderNo)}</b>. The items are back in stock on your ad${order.items.length > 1 ? 's' : ''}.`,
    body: itemsTable(order),
    cta: { href: saleUrl(order), label: 'View the order' },
  }),
  text: `${order.buyerName} cancelled order ${order.orderNo}. The items are back in stock.`,
});

// ---------------------------------------------------------------- other
exports.supportReply = (thread, text, staffName) => ({
  subject: `Re: your message to ${NAME()} (${thread.ticketNo})`,
  html: layout({
    preheader: String(text).slice(0, 90),
    icon: '💬',
    title: `${first(thread.customer?.name)}, we’ve replied to your message`,
    intro: `${esc(staffName || 'Our team')} from ${esc(NAME())} support wrote:`,
    body: `<div style="background:#faf8f5;border-left:4px solid ${BRAND};border-radius:10px;padding:14px 16px;margin:6px 0 10px;color:${INK};font-size:15px;line-height:1.6;white-space:pre-wrap;">${esc(text)}</div>
      <p style="margin:12px 0 0;color:${MUTED};font-size:13px;">Conversation ${esc(thread.ticketNo)}. Reply in the chat so the whole team can see it.</p>`,
    cta: { href: `${URL_()}/help?chat=${thread.token}`, label: 'Open the conversation' },
  }),
  text: `${staffName || NAME() + ' support'} replied to your message (${thread.ticketNo}):\n\n${text}\n\nContinue the conversation: ${URL_()}/help?chat=${thread.token}`,
});

exports.verifyEmail = (customer, link, hours) => ({
  subject: `Confirm your email for ${NAME()}`,
  html: layout({
    preheader: `One click to activate your ${NAME()} account`,
    icon: '✉️',
    title: `Welcome, ${first(customer.name)}! Confirm your email`,
    intro: `Thanks for joining ${esc(NAME())}. Click the button below to confirm this is your email address. Then log in to start buying and selling. The link expires in <b>${hours} hours</b>.`,
    body: `<p style="margin:8px 0 0;color:${MUTED};font-size:13px;line-height:1.6;">Didn’t sign up? You can ignore this email; no account will be activated.</p>
      <p style="margin:10px 0 0;color:${MUTED};font-size:12px;word-break:break-all;">If the button doesn’t work, copy this link into your browser:<br>${esc(link)}</p>`,
    cta: { href: link, label: 'Confirm my email' },
  }),
  text: `Confirm your email for ${NAME()}\n\nOpen this link within ${hours} hours to activate your account:\n${link}\n\nDidn't sign up? Ignore this email.`,
});

// someone tried to sign up with an email that already has an account (we never say so on the website)
exports.accountExists = (customer, loginLink, resetLink) => ({
  subject: `You already have a ${NAME()} account`,
  html: layout({
    preheader: 'Someone tried to create a new account with your email',
    icon: '👋',
    title: `You already have an account, ${first(customer.name)}`,
    intro: `Someone (probably you) tried to create a new ${esc(NAME())} account with this email address. You already have one, so nothing was changed.`,
    body: `<p style="margin:8px 0 0;color:${MUTED};font-size:13px;line-height:1.6;">Forgot your password? <a href="${esc(resetLink)}">Reset it here</a>. If this wasn’t you, you can ignore this email.</p>`,
    cta: { href: loginLink, label: 'Log in' },
  }),
  text: `You already have a ${NAME()} account with this email, so nothing was changed.\nLog in: ${loginLink}\nForgot your password? ${resetLink}`,
});

exports.passwordReset = (customer, link, minutes) => ({
  subject: `Reset your ${NAME()} password`,
  html: layout({
    preheader: `Use this link within ${minutes} minutes to choose a new password`,
    icon: '🔑',
    title: `Reset your password, ${first(customer.name)}`,
    intro: `We received a request to reset the password for your ${esc(NAME())} account. Click the button below to choose a new one. The link works once and expires in <b>${minutes} minutes</b>.`,
    body: `<p style="margin:8px 0 0;color:${MUTED};font-size:13px;line-height:1.6;">Didn’t ask for this? You can ignore this email; your password won’t change.</p>
      <p style="margin:10px 0 0;color:${MUTED};font-size:12px;word-break:break-all;">If the button doesn’t work, copy this link into your browser:<br>${esc(link)}</p>`,
    cta: { href: link, label: 'Choose a new password' },
  }),
  text: `Reset your ${NAME()} password\n\nOpen this link within ${minutes} minutes to choose a new password (it works once):\n${link}\n\nDidn't ask for this? Ignore this email; your password won't change.`,
});

exports.newMarketChat = (seller, buyerName, listing, text, convId) => ({
  subject: `${first(buyerName)} is interested in your ad "${listing.title}"`,
  html: layout({
    preheader: String(text).slice(0, 90),
    icon: '💬',
    title: 'New message about your ad',
    intro: `Hi ${esc(first(seller.name))}, <b>${esc(buyerName)}</b> sent you a message about <b>${esc(listing.title)}</b> on ${esc(NAME())}:`,
    body: `<div style="background:#faf8f5;border-left:4px solid ${BRAND};border-radius:10px;padding:14px 16px;margin:6px 0 10px;color:${INK};font-size:15px;line-height:1.6;white-space:pre-wrap;">${esc(text)}</div>
      <p style="margin:12px 0 0;color:${MUTED};font-size:13px;line-height:1.6;">Reply in ${esc(NAME())} messages. For your safety, meet in a public place and never send money before seeing the item.</p>`,
    cta: { href: `${URL_()}/market/messages/${convId}`, label: 'Reply to the message' },
  }),
  text: `${buyerName} sent you a message about your ad "${listing.title}":\n\n${text}\n\nReply here: ${URL_()}/market/messages/${convId}`,
});

exports.test = (to) => ({
  subject: `${NAME()} test email ✉️`,
  html: layout({
    preheader: 'Your email settings work',
    icon: '✉️',
    title: 'It works!',
    intro: `This is a test email from ${esc(NAME())}, sent to <b>${esc(to)}</b>. Buyers and sellers will receive order and message updates like this one.`,
    body: '',
    cta: { href: `${URL_()}/`, label: 'Open the marketplace' },
  }),
  text: `Your ${NAME()} email settings work!`,
});

// to our team: a paid order to track (the payment ID, the buyer, each seller, what and where)
exports.teamNewOrder = (orders, ref, url) => {
  const first = orders[0];
  const total = orders.reduce((sum, order) => sum + (order.total - (order.payOnDelivery || 0)), 0);
  const direct = !!first.payment?.direct;
  const where = [first.delivery?.method, first.delivery?.address, first.delivery?.county].filter(Boolean).join(', ');
  const sellers = orders.map((order) => `<p style="margin:12px 0 4px"><b>${esc(order.sellerName)}</b> · order ${esc(order.orderNo)} · ${ksh(order.total)}</p>` + itemsTable(order)).join('');
  return {
    subject: `New paid order ${ref}: ${ksh(total)} from ${first.buyerName}`,
    html: layout({
      preheader: `${orders.length} order${orders.length === 1 ? '' : 's'} paid, payment ID ${ref}`,
      icon: '🧾',
      title: 'New paid order',
      intro: direct
        ? `<b>${esc(first.buyerName)}</b> paid ${ksh(first.payment?.amount ?? total)} straight to <b>${esc(first.sellerName)}</b>${first.payment?.fee?.amount ? ` and ${ksh(first.payment.fee.amount)} to Kapu for our agent’s verification and inspection` : ''}. Track it with the payment ID below.`
        : `<b>${esc(first.buyerName)}</b> paid ${ksh(total)} to the Kapu wallet (goods and delivery). Track it with the payment ID below.`,
      body: infoRows([
        ['Payment ID', ref], ['M-Pesa reference', first.payment?.receipt || '–'], ['Paid', when(first.payment?.paidAt)],
        ['Buyer', `${first.buyerName} · ${first.buyerPhone || ''}`], ['Deliver', where || '–'], ['Sellers', String(orders.length)],
      ]) + sellers,
      cta: { href: `${url}/admin/orders?q=${encodeURIComponent(ref)}`, label: 'Open in admin' },
    }),
    text: `New paid order. Payment ID ${ref}. ${first.buyerName} paid ${ksh(total)} (M-Pesa ${first.payment?.receipt || '-'}). Orders: ${orders.map((order) => order.orderNo + ' (' + order.sellerName + ')').join(', ')}.`,
  };
};
