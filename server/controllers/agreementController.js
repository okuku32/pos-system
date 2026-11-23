// Lipa Pole Pole sale agreements between nearby buyers and sellers (furniture).
//  1. From their chat, the buyer or the seller fills in the agreement: price, deposit paid, deadline, who keeps the item…
//  2. The other person checks it, adds their details (ID number, location) and accepts → the agreement is active.
//     The deposit is recorded as the first payment.
//  3. Each later payment is recorded (the seller records money received; a payment the buyer reports waits for the
//     seller to confirm). When the balance reaches zero the agreement is completed.
// Money moves directly between the two people, so it isn't covered by Lipa Salama: the agreement and the
// Lipa Pole Pole policy are their protection, and anything done outside them is at their own risk.
const crypto = require('crypto');
const mongoose = require('mongoose');
const Agreement = require('../models/Agreement');
const Listing = require('../models/Listing');
const Conversation = require('../models/Conversation');
const Customer = require('../models/Customer');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const { emitCustomer, emitAdmin } = require('../utils/realtime');
const { invalidate } = require('../utils/cache');
const { COUNTIES } = require('../market/categories');

const AGREEMENT_CATEGORIES = ['furniture']; // nearby, bulky items that buyers often collect in person
exports.AGREEMENT_CATEGORIES = AGREEMENT_CATEGORIES;
const isId = (value) => mongoose.isValidObjectId(value);
const clean = (text, max) => String(text ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const ksh = (amount) => `KSh ${Number(amount || 0).toLocaleString('en-KE')}`;
const money = (amount) => Math.round(Number(String(amount ?? '').replace(/[^\d.]/g, '')));
const ID_RX = /^[A-Za-z0-9]{6,12}$/; // Kenyan ID (7–8 digits) or passport

const ACTIVE = ['active', 'completed'];
const hideContact = (contact) => { const object = contact?.toObject ? contact.toObject() : { ...(contact || {}) }; delete object.phone; delete object.email; delete object.idNumber; return object; };

function view(agreement, me) {
  const role = me === 'admin' ? 'admin' : String(agreement.seller.customer) === String(me) ? 'seller' : 'buyer';
  const paid = (agreement.payments || []).filter((payment) => payment.status === 'confirmed').reduce((total, item) => total + item.amount, 0);
  const balance = Math.max(0, agreement.price - paid);
  const overdue = agreement.status === 'active' && balance > 0 && new Date(agreement.deadline) < new Date();
  return {
    _id: agreement._id, agreementNo: agreement.agreementNo, role, conversation: agreement.conversation, listing: agreement.listing, item: agreement.item,
    // the other side's phone and email stay hidden until both have agreed (no contact harvesting from a chat)
    seller: role === 'seller' || role === 'admin' || ACTIVE.includes(agreement.status) ? agreement.seller : hideContact(agreement.seller),
    buyer: role === 'buyer' || role === 'admin' || ACTIVE.includes(agreement.status) ? agreement.buyer : hideContact(agreement.buyer),
    createdBy: agreement.createdBy, agreementDate: agreement.agreementDate,
    price: agreement.price, deposit: agreement.deposit, paid, balance, deadline: agreement.deadline, schedule: agreement.schedule, possession: agreement.possession, notes: agreement.notes,
    payments: agreement.payments, status: agreement.status, overdue, cancelReason: agreement.cancelReason, cancelledBy: agreement.cancelledBy, policyVersion: agreement.policyVersion,
    createdAt: agreement.createdAt, updatedAt: agreement.updatedAt,
  };
}
function broadcast(value) {
  for (const who of [value.seller.customer, value.buyer.customer]) emitCustomer(String(who), 'agreement:update', view(value, who));
  emitAdmin('agreement:update', view(value, 'admin'));
}
// a short note in the chat so both see what happened
async function chatNote(value, me, text) {
  if (!value.conversation) return;
  const conv = await Conversation.findById(value.conversation);
  if (conv) await require('./marketController').addMessage(conv, me, text, { kind: 'system' });
}

function partyFrom(body, customer) {
  const idNumber = clean(body.idNumber, 12).replace(/\s/g, '');
  if (!ID_RX.test(idNumber)) throw httpError('Please enter your national ID or passport number (as on the document)');
  const county = String(body.county || customer.county || '');
  if (!COUNTIES.includes(county)) throw httpError('Please choose your county');
  const address = clean(body.address, 200);
  if (address.length < 3) throw httpError('Please enter your estate / town');
  if (!customer.phone) throw httpError('Add your phone number to your account first (Account → Profile)');
  return { customer: customer._id, name: customer.name, phone: customer.phone, email: customer.email, idNumber, county, address };
}

// POST /api/agreements { conversationId, price, deposit, depositMethod, deadline, schedule, possession, notes, idNumber, county, address, agree }
exports.create = asyncHandler(async (req, res) => {
  const me = req.customer;
  if (!(req.body.agree === true || req.body.agree === 'true')) throw httpError('Please read and accept the Lipa Pole Pole policy');
  if (!isId(req.body.conversationId)) throw httpError('Open the agreement from your chat with the other person', 400);
  const conv = await Conversation.findById(req.body.conversationId).lean();
  const myRole = conv && (String(conv.seller) === String(me._id) ? 'seller' : String(conv.buyer) === String(me._id) ? 'buyer' : null);
  if (!myRole) throw httpError('Chat not found', 404);
  const listing = await Listing.findById(conv.listing).lean();
  if (!listing || !['active'].includes(listing.status)) throw httpError('This ad is no longer available');
  if (!AGREEMENT_CATEGORIES.includes(listing.category)) throw httpError('Lipa Pole Pole agreements are for furniture. For other items use Lipa Pole Pole at checkout.');
  if (await Agreement.exists({ listing: listing._id, 'buyer.customer': conv.buyer, status: { $in: ['waiting_buyer', 'waiting_seller', 'active'] } })) {
    throw httpError('There is already an agreement for this item between you two. Open it from My orders.', 409);
  }
  const me_ = partyFrom(req.body, me);
  // nearby only: the buyer must be in the same county as the item
  const buyerCounty = myRole === 'buyer' ? me_.county : (await Customer.findById(conv.buyer).select('county').lean())?.county;
  if (myRole === 'buyer' && me_.county !== listing.county) throw httpError(`Direct Lipa Pole Pole is for buyers near the seller: this item is in ${listing.county}. Use Lipa Pole Pole at checkout instead.`);
  const price = money(req.body.price);
  if (!(price >= 500)) throw httpError('Please enter the total agreed price');
  const deposit = money(req.body.deposit || 0);
  if (!(deposit >= 0) || deposit >= price) throw httpError('The deposit must be less than the total price');
  if (deposit < Math.ceil(price * 0.1)) throw httpError(`Lipa Pole Pole policy: the deposit must be at least 10% (${ksh(Math.ceil(price * 0.1))})`);
  const deadline = new Date(req.body.deadline);
  const maxDays = 90;
  if (Number.isNaN(deadline.getTime()) || deadline < new Date(Date.now() + 86400000) || deadline > new Date(Date.now() + maxDays * 86400000)) {
    throw httpError(`Choose a deadline between tomorrow and ${maxDays} days from today`);
  }
  const possession = req.body.possession === 'buyer_now' ? 'buyer_now' : 'after_payment';

  const other = await Customer.findById(myRole === 'seller' ? conv.buyer : conv.seller).select('name phone email county').lean();
  const agreement = await Agreement.create({
    agreementNo: `LPA-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    conversation: conv._id,
    listing: listing._id,
    item: { title: listing.title, slug: listing.slug, image: listing.images?.[0] || '', category: listing.category, sub: listing.sub, description: clean(listing.description, 300) },
    seller: myRole === 'seller' ? { ...me_, acceptedAt: new Date() } : { customer: conv.seller, name: other.name, phone: other.phone, email: other.email, county: listing.county },
    buyer: myRole === 'buyer' ? { ...me_, acceptedAt: new Date() } : { customer: conv.buyer, name: other.name, phone: other.phone, email: other.email, county: buyerCounty || other.county },
    createdBy: myRole,
    price, deposit, deadline, possession,
    schedule: clean(req.body.schedule, 200),
    notes: clean(req.body.notes, 500),
    // the deposit is the first payment; it counts once both have accepted
    payments: deposit > 0 ? [{ amount: deposit, date: new Date(), method: ['cash', 'mpesa', 'bank', 'other'].includes(req.body.depositMethod) ? req.body.depositMethod : 'cash', ref: clean(req.body.depositRef, 40), recordedBy: myRole, status: 'pending' }] : [],
    status: myRole === 'seller' ? 'waiting_buyer' : 'waiting_seller',
  });
  await chatNote(agreement, me, `📝 ${me.name.split(' ')[0]} prepared a Lipa Pole Pole sale agreement (${agreement.agreementNo}): ${ksh(price)}, deposit ${ksh(deposit)}, balance by ${deadline.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}. Please review and accept it.`);
  broadcast(agreement);
  res.status(201).json(view(agreement, me._id));
});

async function loadFor(req) {
  if (!isId(req.params.id)) throw httpError('Agreement not found', 404);
  const agreement = await Agreement.findById(req.params.id);
  const me = String(req.customer._id);
  if (!agreement || (String(agreement.seller.customer) !== me && String(agreement.buyer.customer) !== me)) throw httpError('Agreement not found', 404);
  return { a: agreement, role: String(agreement.seller.customer) === me ? 'seller' : 'buyer' };
}

// GET /api/agreements/:id
exports.get = asyncHandler(async (req, res) => {
  const { a: value } = await loadFor(req);
  res.json(view(value, req.customer._id));
});

// POST /api/agreements/:id/accept { idNumber, county, address, agree }
exports.accept = asyncHandler(async (req, res) => {
  const { a: value, role } = await loadFor(req);
  if (value.status !== (role === 'buyer' ? 'waiting_buyer' : 'waiting_seller')) throw httpError('This agreement is not waiting for you');
  if (!(req.body.agree === true || req.body.agree === 'true')) throw httpError('Please read and accept the agreement and the Lipa Pole Pole policy');
  const party = partyFrom(req.body, req.customer);
  if (role === 'buyer' && party.county !== value.seller.county) throw httpError(`Direct Lipa Pole Pole is for buyers near the seller (${value.seller.county}). Use Lipa Pole Pole at checkout instead.`);
  value[role] = { ...party, acceptedAt: new Date() };
  value.status = 'active';
  value.agreementDate = new Date(); // the day both accepted
  // the deposit counts once the seller has accepted (the seller confirms having received it)
  value.payments.forEach((payment) => {
    payment.status = 'confirmed';
  });
  if (value.paid >= value.price) value.status = 'completed';
  await value.save();
  // the item is committed to this buyer
  await Listing.updateOne({ _id: value.listing, status: 'active' }, { $set: { status: 'sold' } });
  invalidate('market:');
  await chatNote(value, req.customer, `✅ Agreement ${value.agreementNo} accepted by both. Balance ${ksh(value.price - value.paid)} by ${value.deadline.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.`);
  broadcast(value);
  res.json(view(value, req.customer._id));
});

// POST /api/agreements/:id/payments { amount, date, method, ref }
// The seller records money received; a payment the buyer reports waits for the seller to confirm it.
exports.addPayment = asyncHandler(async (req, res) => {
  const { a: value, role } = await loadFor(req);
  if (value.status !== 'active') throw httpError('Payments can be recorded on active agreements only');
  const amount = money(req.body.amount);
  const balance = value.price - value.paid;
  if (!(amount >= 1)) throw httpError('Enter the amount paid');
  if (amount > balance) throw httpError(`That’s more than the balance of ${ksh(balance)}`);
  const date = req.body.date ? new Date(req.body.date) : new Date();
  if (Number.isNaN(date.getTime()) || date > new Date(Date.now() + 86400000)) throw httpError('Enter a valid payment date');
  value.payments.push({ amount, date, method: ['cash', 'mpesa', 'bank', 'other'].includes(req.body.method) ? req.body.method : 'cash', ref: clean(req.body.ref, 40), recordedBy: role, status: role === 'seller' ? 'confirmed' : 'pending' });
  if (value.paid >= value.price) value.status = 'completed';
  await value.save();
  await chatNote(value, req.customer, role === 'seller'
    ? `💵 Seller recorded ${ksh(amount)} received for ${value.agreementNo}. ${value.status === 'completed' ? 'Fully paid 🎉' : `Balance ${ksh(value.price - value.paid)}.`}`
    : `💵 Buyer reported paying ${ksh(amount)} for ${value.agreementNo}. Seller, please confirm it in the agreement.`);
  broadcast(value);
  res.status(201).json(view(value, req.customer._id));
});

// POST /api/agreements/:id/payments/:paymentId/confirm  (seller confirms a payment the buyer reported)
exports.confirmPayment = asyncHandler(async (req, res) => {
  const { a: value, role } = await loadFor(req);
  if (role !== 'seller') throw httpError('Only the seller can confirm payments', 403);
  const payment = value.payments.id(req.params.paymentId);
  if (!payment || payment.status !== 'pending') throw httpError('Payment not found');
  if (req.body.reject === true) {
    payment.deleteOne();
  } else {
    if (payment.amount > value.price - value.paid) throw httpError('That’s more than the balance');
    payment.status = 'confirmed';
  }
  if (value.paid >= value.price) value.status = 'completed';
  await value.save();
  await chatNote(value, req.customer, req.body.reject === true ? `✖️ Seller did not confirm a reported payment on ${value.agreementNo}.` : `✅ Seller confirmed ${ksh(payment.amount)} for ${value.agreementNo}. ${value.status === 'completed' ? 'Fully paid 🎉' : `Balance ${ksh(value.price - value.paid)}.`}`);
  broadcast(value);
  res.json(view(value, req.customer._id));
});

// POST /api/agreements/:id/cancel { reason }
exports.cancel = asyncHandler(async (req, res) => {
  const { a: value, role } = await loadFor(req);
  if (['completed', 'cancelled'].includes(value.status)) throw httpError('This agreement is already closed');
  const reason = clean(req.body.reason, 200);
  if (value.status === 'active' && reason.length < 3) throw httpError('Please give a reason (the other person will see it)');
  const wasActive = value.status === 'active';
  value.status = 'cancelled';
  value.cancelReason = reason || 'Not accepted';
  value.cancelledBy = role;
  await value.save();
  if (wasActive) {
    await Listing.updateOne({ _id: value.listing, status: 'sold' }, { $set: { status: 'active' } }); // back on sale
    invalidate('market:');
  }
  await chatNote(value, req.customer, `✖️ Agreement ${value.agreementNo} cancelled by the ${role}: ${value.cancelReason}. Any refund is settled between you according to the agreement and the Lipa Pole Pole policy.`);
  broadcast(value);
  res.json(view(value, req.customer._id));
});

// GET /api/agreements/mine  (as buyer or seller)
exports.mine = asyncHandler(async (req, res) => {
  const me = req.customer._id;
  const list = await Agreement.find({ $or: [{ 'seller.customer': me }, { 'buyer.customer': me }] }).sort({ updatedAt: -1 }).limit(100);
  res.json(list.map((item) => view(item, me)));
});

// GET /api/agreements/for/:conversationId  (is there an agreement in this chat?)
exports.forConversation = asyncHandler(async (req, res) => {
  if (!isId(req.params.conversationId)) return res.json(null);
  const agreement = await Agreement.findOne({ conversation: req.params.conversationId, $or: [{ 'seller.customer': req.customer._id }, { 'buyer.customer': req.customer._id }] }).sort({ createdAt: -1 });
  res.json(agreement ? view(agreement, req.customer._id) : null);
});

// GET /api/agreements/admin/list?status=
exports.adminList = asyncHandler(async (req, res) => {
  const filter = req.query.status ? { status: String(req.query.status) } : {};
  const list = await Agreement.find(filter).sort({ updatedAt: -1 }).limit(200);
  res.json(list.map((item) => view(item, 'admin')));
});
