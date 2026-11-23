// The order receipt (PDF) a buyer downloads: what they bought (with size, colour…), where it's going, what they
// paid and what's left to pay on delivery, who's selling and delivering it, a checklist for when it arrives, and
// the order's history, so our team can trace any problem from the order number.
const { Pdf, wrap } = require('./pdf');
const { fieldsFor } = require('./categories');

const BRAND = '#ff5a1f';
const INK = '#14171f';
const MUTED = '#6b7280';
const LINE = '#e3e5ea';
const SOFT = '#f6f7f9';

const ksh = (amount) => `KSh ${Math.round(Number(amount) || 0).toLocaleString('en-KE')}`;
const when = (date) => (date ? new Date(date).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const phoneText = (value) => (value ? String(value).replace(/^254(\d{3})(\d{3})(\d{3})$/, '0$1 $2 $3') : '');

const STATUS = { awaiting_payment: 'Waiting for payment', placed: 'Placed', confirmed: 'Confirmed by the seller', shipped: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled' };
const METHOD = { delivery: 'Delivery by the seller', pickup: 'Pickup from the seller', walk: 'Walking delivery by the shop', rider: 'Delivery by our rider', courier: 'Courier (sent by our agent)' };
const PAYMENT = {
  mpesa: { pending: 'M-Pesa: waiting for payment', paid: 'Paid with M-Pesa', failed: 'M-Pesa payment failed', refund_due: 'Refund due', refunded: 'Refunded' },
  cod: { cod: 'Pay on delivery', paid: 'Paid on delivery' },
};

// "Size: M · Colour: Pink · Condition: New"
function details(item) {
  const fields = item.category ? fieldsFor(item.category, item.sub) : [];
  const parts = [];
  for (const [key, value] of Object.entries(item.attrs || {})) {
    if (value == null || value === '' || typeof value === 'object') continue;
    const field = fields.find((currentField) => currentField.key === key);
    if (!field) continue;
    parts.push(`${field.label.replace(/\s*\(.*\)$/, '')}: ${value}`);
  }
  if (item.condition) parts.push(`Condition: ${item.condition}`);
  return parts.join(' · ');
}

function buildReceipt(receipt, { role = 'buyer', seller = null, team = [], site = {}, url = '' } = {}) {
  const doc = new Pdf();
  const match = 40; // margin
  const ratio = doc.W - match; // right edge
  const CW = ratio - match; // content width
  let year = 0;
  let page = 1;

  const footer = () => {
    doc.line(match, doc.H - 34, ratio, doc.H - 34, { color: LINE });
    doc.text(`${site.name || 'Kapu'} · Order ${receipt.orderNo} · page ${page}`, match, doc.H - 28, { size: 8, color: MUTED });
    doc.text(`Downloaded ${when(new Date())}`, match, doc.H - 28, { size: 8, color: MUTED, align: 'right', width: CW });
  };
  const need = (height) => {
    if (year + height <= doc.H - 50) return;
    footer();
    doc.addPage();
    page += 1;
    year = 40;
  };
  const heading = (value) => {
    need(40);
    year += 8;
    doc.text(value.toUpperCase(), match, year, { size: 9, bold: true, color: BRAND });
    year += 14;
    doc.line(match, year, ratio, year, { color: LINE });
    year += 8;
  };
  // label: value rows, wrapping long values
  const rows = (list, currentLeft = match, width = CW, labelW = 110) => {
    for (const [label, value] of list) {
      if (value == null || value === '') continue;
      const lines = wrap(value, 10, false, width - labelW);
      need(lines.length * 13 + 2);
      doc.text(label, currentLeft, year, { size: 9, color: MUTED });
      lines.forEach((line, index) => doc.text(line, currentLeft + labelW, year + index * 13, { size: 10 }));
      year += lines.length * 13 + 3;
    }
  };

  // ---------------- header
  doc.rect(0, 0, doc.W, 92, { fill: BRAND });
  doc.text(site.name || 'Kapu', match, 26, { size: 22, bold: true, color: '#ffffff' });
  doc.text(role === 'seller' ? 'Sales receipt' : 'Order receipt', match, 54, { size: 11, color: '#ffe1d1' });
  doc.text(`Order ${receipt.orderNo}`, match, 24, { size: 16, bold: true, color: '#ffffff', align: 'right', width: CW });
  doc.text(`Placed ${when(receipt.createdAt)}`, match, 46, { size: 10, color: '#ffe1d1', align: 'right', width: CW });
  doc.text(`Status: ${STATUS[receipt.status] || receipt.status}`, match, 61, { size: 10, bold: true, color: '#ffffff', align: 'right', width: CW });
  year = 110;

  // ---------------- buyer & delivery | seller (two columns)
  const half = (CW - 20) / 2;
  const col = (item, title, list) => {
    let yy = year;
    doc.text(title.toUpperCase(), item, yy, { size: 9, bold: true, color: BRAND });
    yy += 16;
    for (const [label, value] of list) {
      if (!value) continue;
      doc.text(label, item, yy, { size: 8, color: MUTED });
      yy += 11;
      for (const element of wrap(value, 10, false, half)) {
        doc.text(element, item, yy, { size: 10 });
        yy += 13;
      }
      yy += 3;
    }
    return yy;
  };
  const delivery = receipt.delivery || {};
  const shop = seller?.shopLocation || {};
  const pickup = delivery.method === 'pickup';
  const pin = delivery.lat != null && delivery.lng != null ? `https://maps.google.com/?q=${Number(delivery.lat).toFixed(5)},${Number(delivery.lng).toFixed(5)}` : '';
  const left = col(match, pickup ? 'Buyer · pickup' : 'Buyer · deliver to', [
    ['Name', receipt.buyerName],
    ['Phone', phoneText(receipt.buyerPhone)],
    ['How', `${METHOD[delivery.method] || delivery.method}${delivery.km ? ` (${delivery.km} km)` : ''}`],
    ...(pickup
      ? [['Pick up at', [shop.name, shop.address, delivery.pickupArea].filter(Boolean).join(', ')]]
      : [['Delivery address', [delivery.address, delivery.county].filter(Boolean).join(', ') || 'Not given'], ['Map pin', pin]]),
    ['Delivery notes', delivery.notes],
  ]);
  const right = col(match + half + 20, 'Seller', [
    ['Shop', shop.name || receipt.sellerName],
    ['Seller', receipt.sellerName],
    ['Address', [shop.address, shop.area && !String(shop.address || '').includes(shop.area) ? shop.area : '', shop.county].filter(Boolean).join(', ')],
    ['Phone', phoneText(seller?.phone)],
    ['M-Pesa (pay on delivery)', receipt.payment?.method === 'cod' || receipt.payOnDelivery ? receipt.sellerPay?.text : ''],
  ]);
  year = Math.max(left, right) + 4;

  // ---------------- items
  heading('Items');
  const cQty = match + CW - 230;
  const cPrice = match + CW - 170;
  const cAmt = match + CW - 85;
  doc.rect(match, year - 2, CW, 18, { fill: SOFT });
  doc.text('Item', match + 6, year + 2, { size: 9, bold: true, color: MUTED });
  doc.text('Qty', cQty, year + 2, { size: 9, bold: true, color: MUTED, align: 'right', width: 40 });
  doc.text('Unit price', cPrice, year + 2, { size: 9, bold: true, color: MUTED, align: 'right', width: 75 });
  doc.text('Amount', cAmt, year + 2, { size: 9, bold: true, color: MUTED, align: 'right', width: 79 });
  year += 22;
  const itemW = cQty - match - 16;
  receipt.items.forEach((it, index) => {
    const title = wrap(`${index + 1}. ${it.title}`, 10, true, itemW);
    const info = details(it);
    const sub = info ? wrap(info, 8.5, false, itemW - 12) : [];
    const height = title.length * 13 + sub.length * 11 + 8;
    need(height);
    title.forEach((item, position) => doc.text(item, match + 6, year + position * 13, { size: 10, bold: true }));
    sub.forEach((item, position) => doc.text(item, match + 18, year + title.length * 13 + position * 11, { size: 8.5, color: MUTED }));
    doc.text(String(it.qty), cQty, year, { size: 10, align: 'right', width: 40 });
    doc.text(ksh(it.price), cPrice, year, { size: 10, align: 'right', width: 75 });
    doc.text(ksh(it.subtotal), cAmt, year, { size: 10, bold: true, align: 'right', width: 79 });
    year += height;
    doc.line(match, year - 4, ratio, year - 4, { color: LINE });
  });

  // ---------------- totals
  const totals = [['Items', ksh(receipt.subtotal)]];
  if (delivery.method === 'courier' && receipt.rider?.courier) {
    totals.push([`Courier: ${receipt.rider.courier.name}`, ksh(receipt.rider.courier.fare)]);
    totals.push(['Our agent’s handling', ksh(receipt.rider.courier.handling)]);
  } else if (delivery.method !== 'pickup') totals.push([delivery.method === 'rider' ? (receipt.rider?.combined ? 'Delivery by our agent' : 'Rider delivery') : delivery.method === 'walk' ? 'Walking delivery' : 'Delivery', receipt.deliveryFee ? ksh(receipt.deliveryFee) : 'Free']);
  if (receipt.inspection?.fee) totals.push(['Inspection by our agent', ksh(receipt.inspection.fee)]);
  need(totals.length * 15 + 30);
  year += 4;
  const tx = match + CW - 250;
  for (const [key, value] of totals) {
    doc.text(key, tx, year, { size: 10, color: MUTED });
    doc.text(value, tx, year, { size: 10, align: 'right', width: 250 });
    year += 15;
  }
  doc.line(tx, year, ratio, year, { color: INK, lineWidth: 0.8 });
  year += 5;
  doc.text('Total', tx, year, { size: 12, bold: true });
  doc.text(ksh(receipt.total), tx, year, { size: 12, bold: true, align: 'right', width: 250 });
  year += 22;

  // ---------------- payment
  heading('Payment');
  const payment = receipt.payment || {};
  const cash = payment.method === 'mpesa' ? receipt.payOnDelivery || 0 : 0;
  rows([
    ['Payment ID', payment.ref || ''],
    ['Status', PAYMENT[payment.method]?.[payment.status] || payment.status],
    ['Paid now', payment.method === 'mpesa' && payment.status === 'paid' ? `${ksh(receipt.total - cash)} with M-Pesa${payment.receipt ? ` (receipt ${payment.receipt})` : ''}${payment.paidAt ? `, ${when(payment.paidAt)}` : ''}` : ''],
    ['Paid to', payment.direct && payment.to?.text ? `${payment.to.text}: straight to the seller (one of several sellers in this checkout)` : ''],
    ['M-Pesa phone', payment.method === 'mpesa' ? phoneText(payment.phone) : ''],
    ['Pay on delivery', payment.method === 'cod' ? `${ksh(receipt.total - (delivery.method === 'rider' ? receipt.rider?.fee || 0 : 0))} to the seller${receipt.sellerPay?.text ? `: ${receipt.sellerPay.text}` : ''}${delivery.method === 'rider' && receipt.rider?.fee ? `, plus ${ksh(receipt.rider.fee)} delivery fee in cash to our rider` : ''}` : cash ? `${ksh(cash)} delivery fee, in cash when it arrives` : ''],
    ['Cancelled', receipt.status === 'cancelled' ? `${receipt.cancelReason || 'Cancelled'}${receipt.cancelledBy ? ` (by the ${receipt.cancelledBy})` : ''}` : ''],
  ]);

  // ---------------- our field team
  if (receipt.rider?.name || receipt.rider?.courier || receipt.inspection?.status || receipt.shipNote) {
    heading('Delivery & inspection');
    rows([
      [receipt.rider?.combined ? 'Our agent' : 'Our rider', receipt.rider?.name ? `${receipt.rider.name}${receipt.rider.phone ? `, ${phoneText(receipt.rider.phone)}` : ''}${receipt.rider.vehicle ? ` · ${receipt.rider.vehicle}` : ''}${receipt.rider.plate ? ` ${receipt.rider.plate}` : ''}` : ''],
      ['Inspection', receipt.inspection?.status ? `${receipt.inspection.free ? 'Free check by our rider: ' : ''}${{ waiting: 'Not started yet', open: 'Looking for an agent', assigned: 'Agent on the way', passed: 'Passed', failed: 'Failed', cancelled: 'Cancelled' }[receipt.inspection.status] || receipt.inspection.status}${receipt.inspection.agentName ? ` (${receipt.inspection.agentName})` : ''}` : ''],
      ['You asked to check', receipt.inspection?.notes],
      ['Agent’s report', receipt.inspection?.result],
      ['Courier', receipt.rider?.courier ? `${receipt.rider.courier.name}${receipt.rider.courier.eta ? ` (${receipt.rider.courier.eta})` : ''}${receipt.rider.courier.waybill ? `, waybill ${receipt.rider.courier.waybill}` : ', waybill: when it’s sent'}${receipt.rider.courier.office ? `, sent from ${receipt.rider.courier.office}` : ''}` : ''],
      [receipt.rider?.courier ? 'Note' : 'Seller’s note', receipt.shipNote],
    ]);
  }

  // ---------------- who attended the order (our rider / shopping agent)
  for (const worker of team) {
    heading(`${worker.role === 'Rider' ? 'Your rider' : 'Your shopping agent'}: ${worker.name}`);
    rows([
      ['Name', worker.name],
      ['Role', `${worker.role}${worker.approved ? ' · ID checked and trained by ' + (site.name || 'Kapu') : ''}`],
      ['Phone', phoneText(worker.phone)],
      ['Ride', worker.vehicle ? `${worker.vehicle}${worker.plate ? `, number plate ${worker.plate}` : ''}` : ''],
      ['Based at', worker.base],
      ['Job', `${worker.job}${worker.passed === true ? ' (inspection passed)' : worker.passed === false ? ' (inspection failed)' : ''}`],
      ['Accepted', when(worker.acceptedAt)],
      ['Picked up', when(worker.pickedUpAt)],
      [worker.job.startsWith('Collected') ? 'Sent' : 'Delivered', worker.status === 'done' || worker.status === 'delivered' ? when(worker.deliveredAt) : ''],
    ]);
  }

  // ---------------- checklist for when it arrives
  if (role !== 'seller' && receipt.status !== 'cancelled') {
    heading(pickup ? 'Check before you leave the shop' : 'Check when it arrives');
    need(20);
    doc.text('Tick each item before you confirm “received”. If anything is wrong, don’t confirm: report it with this order number.', match, year, { size: 9, color: MUTED });
    year += 18;
    receipt.items.forEach((it) => {
      const info = details(it);
      const lines = wrap(`${it.qty} × ${it.title}${info ? ` (${info})` : ''}`, 10, false, CW - 30);
      need(lines.length * 13 + 6);
      doc.rect(match + 2, year, 10, 10, { stroke: INK, lineWidth: 0.8 });
      lines.forEach((line, index) => doc.text(line, match + 22, year + index * 13, { size: 10 }));
      year += lines.length * 13 + 6;
    });
    for (const item of ['Right items and quantities', 'Right size, colour and model', 'Not damaged; seal or packaging intact']) {
      need(18);
      doc.rect(match + 2, year, 10, 10, { stroke: INK, lineWidth: 0.8 });
      doc.text(item, match + 22, year, { size: 10 });
      year += 18;
    }
    need(40);
    year += 14;
    doc.line(match, year, match + 220, year, { color: INK, dash: true });
    doc.line(match + 260, year, ratio, year, { color: INK, dash: true });
    doc.text('Received by (name & signature)', match, year + 4, { size: 8, color: MUTED });
    doc.text('Date & time', match + 260, year + 4, { size: 8, color: MUTED });
    year += 22;
  }

  // ---------------- history
  if (receipt.history?.length) {
    heading('Order history');
    const HIST = { ...STATUS, confirmed: 'Confirmed' };
    receipt.history.forEach((entry, index) => {
      // a step that didn't change the status (e.g. "inspection passed"): just its note
      const same = index > 0 && receipt.history[index - 1].status === entry.status && entry.note;
      const by = { mpesa: '', system: 'automatic', admin: 'our team' }[entry.by] ?? entry.by;
      const who = by ? ` (${by})` : '';
      const text = same ? `${entry.note}${who}` : `${HIST[entry.status] || entry.status}${who}${entry.note ? `: ${entry.note}` : ''}`;
      const lines = wrap(text, 9.5, false, CW - 130);
      need(lines.length * 12 + 4);
      doc.text(when(entry.at), match, year, { size: 9, color: MUTED });
      lines.forEach((line, position) => doc.text(line, match + 130, year + position * 12, { size: 9.5 }));
      year += lines.length * 12 + 4;
    });
  }

  // ---------------- help box
  need(100);
  year += 12;
  doc.rect(match, year, CW, 84, { fill: SOFT, stroke: LINE });
  doc.rect(match, year, 4, 84, { fill: BRAND });
  doc.text('Something wrong with this order?', match + 16, year + 12, { size: 11, bold: true });
  const help = [
    `Quote order number ${receipt.orderNo} when you contact us${site.phone ? ` on ${phoneText(site.phone)}` : ''}${site.email ? ` or ${site.email}` : ''}.`,
    `Keep this receipt until you have checked everything. Your order online: ${url}/orders/${receipt._id}`,
  ];
  let hy = year + 30;
  for (const item of help) {
    for (const element of wrap(item, 9.5, false, CW - 32)) {
      doc.text(element, match + 16, hy, { size: 9.5, color: INK });
      hy += 12;
    }
    hy += 2;
  }
  year += 88;
  footer();
  return doc.toBuffer({ title: `${site.name || 'Kapu'} order ${receipt.orderNo}` });
}

// One receipt for a whole checkout (several sellers): each seller with the items bought from them, the amount paid to
// that seller (and where: Till / Paybill / Pochi), each payment's M-Pesa code, then the total of the goods.
const PART = { paid: 'Paid', queued: 'Waiting: prompt not sent yet', prompted: 'Waiting: M-Pesa prompt sent', manual: 'Not paid yet', claimed: 'Paid: the seller is confirming the M-Pesa code', failed: 'Not paid (failed)', cancelled: 'Cancelled', cod: 'Pay cash on delivery', refund_due: 'Refund due from the seller', refunded: 'Refunded' };
function buildCheckoutReceipt(checkout, { site = {}, url = '' } = {}) {
  const doc = new Pdf();
  const match = 40;
  const ratio = doc.W - match;
  const CW = ratio - match;
  let year = 0;
  let page = 1;
  const ref = String(checkout.checkoutId || '').slice(0, 8).toUpperCase();
  const footer = () => {
    doc.line(match, doc.H - 34, ratio, doc.H - 34, { color: LINE });
    doc.text(`${site.name || 'Kapu'} · Checkout ${ref} · page ${page}`, match, doc.H - 28, { size: 8, color: MUTED });
    doc.text(`Downloaded ${when(new Date())}`, match, doc.H - 28, { size: 8, color: MUTED, align: 'right', width: CW });
  };
  const need = (height) => {
    if (year + height <= doc.H - 50) return;
    footer();
    doc.addPage();
    page += 1;
    year = 40;
  };
  const line = (label, value, { bold = false, size = 10, color = INK } = {}) => {
    need(16);
    doc.text(label, match + CW - 300, year, { size, color: bold ? INK : MUTED, bold });
    doc.text(value, match + CW - 300, year, { size, bold, color, align: 'right', width: 300 });
    year += size + 6;
  };

  doc.rect(0, 0, doc.W, 92, { fill: BRAND });
  doc.text(site.name || 'Kapu', match, 26, { size: 22, bold: true, color: '#ffffff' });
  doc.text(checkout.split ? 'Receipt · paid to each seller directly' : 'Checkout receipt', match, 54, { size: 11, color: '#ffe1d1' });
  doc.text(`Checkout ${ref}`, match, 24, { size: 16, bold: true, color: '#ffffff', align: 'right', width: CW });
  doc.text(`Placed ${when(checkout.createdAt)}`, match, 46, { size: 10, color: '#ffe1d1', align: 'right', width: CW });
  doc.text(`${checkout.sellers} seller${checkout.sellers === 1 ? '' : 's'}`, match, 61, { size: 10, bold: true, color: '#ffffff', align: 'right', width: CW });
  year = 110;
  doc.text('BUYER', match, year, { size: 9, bold: true, color: BRAND });
  year += 15;
  doc.text(`${checkout.buyerName || ''}${checkout.buyerPhone ? ` · ${phoneText(checkout.buyerPhone)}` : ''}`, match, year, { size: 10 });
  year += 14;
  const delivery = checkout.delivery || {};
  if (delivery.method !== 'pickup' && (delivery.address || delivery.county)) {
    for (const element of wrap(`Deliver to: ${[delivery.address, delivery.county].filter(Boolean).join(', ')}`, 10, false, CW)) {
      doc.text(element, match, year, { size: 10, color: MUTED });
      year += 13;
    }
  }
  year += 6;

  checkout.parts.forEach((part, index) => {
    need(70);
    year += 6;
    doc.rect(match, year, CW, 22, { fill: SOFT });
    doc.text(`Seller ${index + 1}: ${part.seller.name || ''}`, match + 8, year + 6, { size: 11, bold: true });
    doc.text(`Order ${part.orderNo}`, match, year + 7, { size: 9, color: MUTED, align: 'right', width: CW - 8 });
    year += 30;
    for (const item of part.items) {
      const title = wrap(`${item.qty} × ${item.title}`, 10, false, CW - 190);
      need(title.length * 13 + 4);
      title.forEach((text, position) => doc.text(text, match + 8, year + position * 13, { size: 10 }));
      doc.text(ksh(item.price), match + CW - 180, year, { size: 10, color: MUTED, align: 'right', width: 80 });
      doc.text(ksh(item.subtotal), match + CW - 90, year, { size: 10, align: 'right', width: 90 });
      year += title.length * 13 + 4;
    }
    doc.line(match + CW - 300, year, ratio, year, { color: LINE });
    year += 6;
    line('Goods from this seller', ksh(part.subtotal));
    if (part.payOnDelivery) line('Delivery fee (paid when it arrives)', ksh(part.payOnDelivery));
    line(checkout.split ? `Amount to pay ${part.seller.name || 'this seller'}` : 'Amount', ksh(part.amount), { bold: true, size: 11 });
    if (checkout.split && part.to?.text) {
      for (const element of wrap(`Paid to: ${part.to.text}`, 9.5, false, CW - 16)) {
        need(13);
        doc.text(element, match + 8, year, { size: 9.5, color: MUTED });
        year += 13;
      }
    }
    need(14);
    const status = PART[part.state] || part.state;
    const code = part.receipt || part.claimCode;
    doc.text(`${status}${part.ref ? ` · Payment ID ${part.ref}` : ''}${code ? ` · M-Pesa ${code}` : ''}${part.paidAt ? ` · ${when(part.paidAt)}` : ''}`, match + 8, year, { size: 10, bold: true, color: part.state === 'paid' ? '#15803d' : part.state === 'failed' ? '#b91c1c' : INK });
    year += 20;
  });

  need(90);
  year += 4;
  doc.line(match + CW - 300, year, ratio, year, { color: INK, lineWidth: 0.8 });
  year += 8;
  line('Total goods', ksh(checkout.goods));
  if (checkout.onDelivery) line('Delivery fees (paid on delivery)', ksh(checkout.onDelivery));
  if (checkout.split) line('Paid / to pay to the sellers', ksh(checkout.sellersNow ?? checkout.payNow));
  if (checkout.fee) {
    line(`Verification & inspection by our agent (${checkout.fee.sellers} seller${checkout.fee.sellers === 1 ? '' : 's'})`, ksh(checkout.fee.amount));
    need(14);
    doc.text(`Paid to ${site.name || 'Kapu'}: ${checkout.fee.state === 'paid' ? `paid${checkout.fee.receipt ? ` · M-Pesa ${checkout.fee.receipt}` : ''}` : 'not paid yet'}`, match + CW - 300, year, { size: 9, color: checkout.fee.state === 'paid' ? '#15803d' : MUTED });
    year += 14;
  }
  if (!checkout.split) line('To pay now', ksh(checkout.payNow));
  line('Total', ksh(checkout.total), { bold: true, size: 13 });
  const paid = checkout.parts.filter((part) => part.state === 'paid').reduce((sum, part) => sum + part.amount, 0) + (checkout.fee?.state === 'paid' ? checkout.fee.amount : 0);
  if (checkout.split) line('Paid so far', ksh(paid), { color: '#15803d' });
  year += 10;
  if (checkout.split) {
    need(40);
    for (const element of wrap(`Each seller was paid directly on their own M-Pesa, so each payment has its own M-Pesa code. The verification fee pays our agent to check that each payment reached the seller and that the goods match your order. For a problem with one seller’s items, quote that seller’s order number. Your orders: ${url}/orders`, 9, false, CW)) {
      doc.text(element, match, year, { size: 9, color: MUTED });
      year += 12;
    }
  }
  footer();
  return doc.toBuffer({ title: `${site.name || 'Kapu'} checkout ${ref}` });
}

module.exports = { buildReceipt, buildCheckoutReceipt };
