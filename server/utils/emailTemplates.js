// Branded Ordersasa emails. Table-based layout with inline styles so they render in Gmail, Outlook and phone mail apps.
const BRAND = '#ff5a1f';
const INK = '#14171f';
const MUTED = '#6b7280';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ksh = (n) => 'KSh ' + Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 });
const first = (name = '') => String(name).trim().split(/\s+/)[0] || 'there';
// Current client's details (white-label): each client's emails carry their own name, address and links
const tset = () => {
  try {
    return require('../tenancy/tenants').settings();
  } catch {
    return null;
  }
};
const STORE = () => tset()?.storeName || 'Ordersasa';
const LOC = () => tset()?.shop?.address || '';
const shopUrl = () => (tset()?.shopUrl || process.env.SHOP_URL || 'http://localhost:5173').replace(/\/$/, '');
const trackUrl = (o) => `${shopUrl()}/track/${o.trackingToken}`;
const time = (d) => new Date(d).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
// "Wed, 11 Nov 2026 at 2:35 pm" in Kenyan time: when the order was placed
const placedAt = (d) => {
  const dt = new Date(d || Date.now());
  const day = dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' });
  const t = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' }).toLowerCase();
  return `${day} at ${t}`;
};

function itemsTable(o) {
  const rows = o.items
    .map((i) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #f0ece6;color:${INK};font-size:14px;">${esc(i.quantity)} × ${esc(i.name)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f0ece6;color:${INK};font-size:14px;text-align:right;white-space:nowrap;">${ksh(i.subtotal)}</td>
      </tr>`)
    .join('');
  const saved = (o.savings || 0) + (o.discount || 0);
  const discount = saved > 0
    ? `<tr><td style="padding:8px 0 0;color:#14a44d;font-size:14px;font-weight:700;">🎉 You saved</td><td style="padding:8px 0 0;color:#14a44d;font-size:14px;font-weight:700;text-align:right;">${ksh(saved)}</td></tr>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">
      ${rows}${discount}
      <tr><td style="padding:12px 0 0;font-weight:800;font-size:16px;color:${INK};">Total</td>
          <td style="padding:12px 0 0;font-weight:800;font-size:16px;color:${INK};text-align:right;">${ksh(o.total)}</td></tr>
    </table>`;
}

function infoRows(rows) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;border-radius:12px;margin:16px 0;">
    ${rows.filter(Boolean).map(([k, v]) => `<tr>
      <td style="padding:10px 16px;color:${MUTED};font-size:13px;width:40%;">${esc(k)}</td>
      <td style="padding:10px 16px;color:${INK};font-size:14px;font-weight:600;">${esc(v)}</td></tr>`).join('')}
  </table>`;
}

function layout({ preheader, icon, title, intro, body, cta }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ec;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;">
        <tr><td style="background:${BRAND};padding:22px 28px;">
          <span style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;background:#ffffff;border-radius:10px;font-size:18px;vertical-align:middle;">🛍️</span>
          <span style="font-size:22px;font-weight:800;color:#ffffff;vertical-align:middle;margin-left:8px;letter-spacing:-0.5px;">${esc(STORE())}</span>
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
          You’re receiving this because you contacted or ordered from ${esc(STORE())}.<br>
          ${LOC() ? `📍 ${esc(LOC())} · ` : ''}Pay with M-Pesa or cash.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// Plain-text version for mail apps that don't show HTML
const textItems = (o) => o.items.map((i) => `  ${i.quantity} x ${i.name}  ${ksh(i.subtotal)}`).join('\n') + `\n  Total: ${ksh(o.total)}`;

exports.orderPlaced = (o, customer) => {
  const delivery = o.type === 'delivery';
  return {
    subject: `We’ve received your order ${o.orderNo} 🧾`,
    html: layout({
      preheader: `Order ${o.orderNo} · ${ksh(o.total)} · we’ll confirm it shortly`,
      icon: '🧾',
      title: `Asante, ${first(customer.name)}! Your order is in.`,
      intro: `We’ve received order <b>${esc(o.orderNo)}</b>, placed on <b>${placedAt(o.createdAt)}</b>. The shop will confirm it in a moment, and you can follow every step live, from packing to ${delivery ? 'your door' : 'pickup'}.`,
      body:
        infoRows([
          ['Order number', o.orderNo],
          ['Placed on', placedAt(o.createdAt)],
          ['Order type', delivery ? 'Delivery' : 'Pickup at the shop'],
          delivery && ['Deliver to', o.customer?.address],
          ['Payment', `M-Pesa or cash on ${delivery ? 'delivery' : 'pickup'}`],
        ]) + itemsTable(o),
      cta: { href: trackUrl(o), label: 'Track your order' },
    }),
    text: `Asante, ${first(customer.name)}! We've received your order ${o.orderNo}, placed on ${placedAt(o.createdAt)}.\n\n${textItems(o)}\n\n${delivery ? `Deliver to: ${o.customer?.address}\n` : 'Pickup at the shop\n'}Pay with M-Pesa or cash on ${delivery ? 'delivery' : 'pickup'}.\n\nTrack your order: ${trackUrl(o)}\n\n${STORE()}`,
  };
};

exports.paymentReceived = (o, customer, sale) => {
  const method = sale.paymentMethod === 'mpesa' ? 'M-Pesa' : 'Cash';
  return {
    subject: `Payment received for ${o.orderNo} ✅`,
    html: layout({
      preheader: `${ksh(sale.total)} paid by ${method} · receipt ${sale.receiptNo}`,
      icon: '✅',
      title: `Payment received, thank you ${first(customer.name)}!`,
      intro: `We’ve received your payment of <b>${ksh(sale.total)}</b> for order <b>${esc(o.orderNo)}</b>. Keep this email as your receipt.`,
      body:
        infoRows([
          ['Order number', o.orderNo],
          ['Ordered on', placedAt(o.createdAt)],
          ['Receipt number', sale.receiptNo],
          ['Amount paid', ksh(sale.total)],
          ['Paid with', method],
          sale.paymentMethod === 'mpesa' && sale.mpesa?.receiptNumber && ['M-Pesa reference', sale.mpesa.receiptNumber],
          sale.paymentMethod === 'cash' && sale.change > 0 && ['Change given', ksh(sale.change)],
          ['Paid on', placedAt(sale.createdAt)],
        ]) + itemsTable(sale),
      cta: { href: trackUrl(o), label: 'View your order' },
    }),
    text: `Payment received for order ${o.orderNo} (ordered on ${placedAt(o.createdAt)}).\nPaid on: ${placedAt(sale.createdAt)}\n\nReceipt: ${sale.receiptNo}\nAmount: ${ksh(sale.total)}\nPaid with: ${method}${sale.mpesa?.receiptNumber ? `\nM-Pesa reference: ${sale.mpesa.receiptNumber}` : ''}\n\n${textItems(sale)}\n\nThank you for shopping with ${STORE()}!`,
  };
};

exports.dispatched = (o, customer) => {
  const eta = o.eta ? ` It should be with you by around <b>${time(o.eta)}</b>.` : '';
  return {
    subject: `Your order ${o.orderNo} is on the way 🛵`,
    html: layout({
      preheader: `Your rider is on the way${o.eta ? `, arriving around ${time(o.eta)}` : ''}`,
      icon: '🛵',
      title: `Good news, ${first(customer.name)}! Your order is on the way.`,
      intro: `Order <b>${esc(o.orderNo)}</b> has been dispatched for delivery.${eta} Please have your phone nearby; the rider may call when they arrive.`,
      body:
        infoRows([
          ['Order number', o.orderNo],
          ['Ordered on', placedAt(o.createdAt)],
          ['Delivering to', o.customer?.address],
          o.eta && ['Estimated arrival', time(o.eta)],
          ['Amount to pay', `${ksh(o.total)} (M-Pesa or cash)`],
        ]) + itemsTable(o),
      cta: { href: trackUrl(o), label: 'Track your delivery live' },
    }),
    text: `Your order ${o.orderNo} (placed ${placedAt(o.createdAt)}) is on the way!${o.eta ? ` Estimated arrival: ${time(o.eta)}.` : ''}\nDelivering to: ${o.customer?.address}\nAmount to pay: ${ksh(o.total)} (M-Pesa or cash)\n\nTrack your delivery: ${trackUrl(o)}\n\n${STORE()}`,
  };
};

exports.readyForPickup = (o, customer) => ({
  subject: `Your order ${o.orderNo} is ready for pickup ✅`,
  html: layout({
    preheader: 'Your order is packed and waiting for you at the counter',
    icon: '🏪',
    title: `${first(customer.name)}, your order is ready!`,
    intro: `Order <b>${esc(o.orderNo)}</b> is packed and waiting at the counter. Pay with M-Pesa or cash when you collect it.`,
    body: infoRows([['Order number', o.orderNo], ['Ordered on', placedAt(o.createdAt)], ['Amount to pay', ksh(o.total)]]) + itemsTable(o),
    cta: { href: trackUrl(o), label: 'View your order' },
  }),
  text: `Your order ${o.orderNo} (placed ${placedAt(o.createdAt)}) is ready for pickup. Amount to pay: ${ksh(o.total)} (M-Pesa or cash).\n\n${trackUrl(o)}\n\n${STORE()}`,
});

exports.cancelled = (o, customer) => ({
  subject: `Your order ${o.orderNo} was cancelled`,
  html: layout({
    preheader: `Order ${o.orderNo} has been cancelled`,
    icon: '✖️',
    title: `Order ${o.orderNo} was cancelled`,
    intro: `Hi ${esc(first(customer.name))}, your order <b>${esc(o.orderNo)}</b> has been cancelled and you have not been charged. If this is unexpected, please reply to this email or contact the shop.`,
    body: infoRows([['Order number', o.orderNo], ['Ordered on', placedAt(o.createdAt)], ['Cancelled on', placedAt(new Date())]]) + itemsTable(o),
    cta: { href: `${shopUrl()}/shop`, label: 'Shop again' },
  }),
  text: `Your order ${o.orderNo} (placed ${placedAt(o.createdAt)}) was cancelled and you have not been charged. If this is unexpected, please contact the shop.\n\n${STORE()}`,
});

exports.supportReply = (thread, text, staffName) => ({
  subject: `Re: your message to ${STORE()} (${thread.ticketNo})`,
  html: layout({
    preheader: String(text).slice(0, 90),
    icon: '💬',
    title: `${first(thread.customer?.name)}, we’ve replied to your message`,
    intro: `${esc(staffName || 'Our team')} from ${esc(STORE())} customer support wrote:`,
    body: `<div style="background:#faf8f5;border-left:4px solid ${BRAND};border-radius:10px;padding:14px 16px;margin:6px 0 10px;color:${INK};font-size:15px;line-height:1.6;white-space:pre-wrap;">${esc(text)}</div>
      <p style="margin:12px 0 0;color:${MUTED};font-size:13px;">Conversation ${esc(thread.ticketNo)}. Reply in the chat so the whole team can see it.</p>`,
    cta: { href: `${shopUrl()}/shop/help?chat=${thread.token}`, label: 'Open the conversation' },
  }),
  text: `${staffName || STORE() + ' support'} replied to your message (${thread.ticketNo}):

${text}

Continue the conversation: ${shopUrl()}/shop/help?chat=${thread.token}

${STORE()}${LOC() ? ' · ' + LOC() : ''}`,
});

exports.passwordReset = (customer, link, minutes) => ({
  subject: `Reset your ${STORE()} password`,
  html: layout({
    preheader: `Use this link within ${minutes} minutes to choose a new password`,
    icon: '🔑',
    title: `Reset your password, ${first(customer.name)}`,
    intro: `We received a request to reset the password for your ${esc(STORE())} account. Click the button below to choose a new one. The link works once and expires in <b>${minutes} minutes</b>.`,
    body: `<p style="margin:8px 0 0;color:${MUTED};font-size:13px;line-height:1.6;">Didn’t ask for this? You can ignore this email; your password won’t change.</p>
      <p style="margin:10px 0 0;color:${MUTED};font-size:12px;word-break:break-all;">If the button doesn’t work, copy this link into your browser:<br>${esc(link)}</p>`,
    cta: { href: link, label: 'Choose a new password' },
  }),
  text: `Reset your ${STORE()} password\n\nOpen this link within ${minutes} minutes to choose a new password (it works once):\n${link}\n\nDidn't ask for this? Ignore this email; your password won't change.`,
});

// Marketplace: someone started a chat about the seller's ad
exports.newMarketChat = (seller, buyerName, listing, text, convId) => ({
  subject: `${first(buyerName)} is interested in your ad "${listing.title}"`,
  html: layout({
    preheader: String(text).slice(0, 90),
    icon: '💬',
    title: 'New message about your ad',
    intro: `Hi ${esc(first(seller.name))}, <b>${esc(buyerName)}</b> sent you a message about <b>${esc(listing.title)}</b> on ${esc(STORE())}:`,
    body: `<div style="background:#faf8f5;border-left:4px solid ${BRAND};border-radius:10px;padding:14px 16px;margin:6px 0 10px;color:${INK};font-size:15px;line-height:1.6;white-space:pre-wrap;">${esc(text)}</div>
      <p style="margin:12px 0 0;color:${MUTED};font-size:13px;line-height:1.6;">Reply in ${esc(STORE())} messages. For your safety, meet in a public place and never send money before seeing the item.</p>`,
    cta: { href: `${shopUrl()}/market/messages/${convId}`, label: 'Reply to the message' },
  }),
  text: `${buyerName} sent you a message about your ad "${listing.title}":\n\n${text}\n\nReply here: ${shopUrl()}/market/messages/${convId}`,
});

exports.test = (to) => ({
  subject: `${STORE()} test email ✉️`,
  html: layout({
    preheader: 'Your email settings work',
    icon: '✉️',
    title: 'Your email settings work!',
    intro: `This is a test email from your ${esc(STORE())} system, sent to <b>${esc(to)}</b>. Customers will receive order, payment and delivery updates like this one.`,
    body: '',
    cta: { href: `${shopUrl()}/shop`, label: 'Open the shop' },
  }),
  text: `Your ${STORE()} email settings work! Customers will receive order, payment and delivery updates.`,
});
