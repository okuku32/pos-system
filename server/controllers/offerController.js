// "Make an offer" — bargaining, in the chat.
//  buyer offers → seller accepts / declines / counters → (after a counter) buyer accepts / declines.
//  An accepted offer on a "Buy online" ad becomes that buyer's price at checkout for 48 hours (used once).
//  For contact-only ads (cars, land…) the agreed price is simply recorded in the chat.
const mongoose = require('mongoose');
const Offer = require('../models/Offer');
const Conversation = require('../models/Conversation');
const asyncHandler = require('../utils/asyncHandler');
const httpError = require('../utils/httpError');
const market = require('./marketController');

const ACCEPT_HOURS = 48;
const ksh = (amount) => `KSh ${Number(amount || 0).toLocaleString('en-KE')}`;
const isId = (value) => mongoose.isValidObjectId(value);
const whole = (value) => Math.round(Number(String(value ?? '').replace(/[^\d.]/g, '')));

const offerView = (offer) => ({
  _id: offer._id, listing: offer.listing, buyer: offer.buyer, seller: offer.seller, amount: offer.amount, qty: offer.qty, listingPrice: offer.listingPrice,
  status: offer.status === 'accepted' && offer.expiresAt && new Date(offer.expiresAt) < new Date() ? 'expired' : offer.status,
  acceptedAt: offer.acceptedAt, expiresAt: offer.expiresAt, history: offer.history, updatedAt: offer.updatedAt, delivery: offer.delivery,
});
exports.offerView = offerView;

// A valid accepted offer this buyer can use at checkout (or null)
exports.usableOffer = async (offerId, buyerId, listingId) => {
  if (!offerId || !isId(offerId)) return null;
  const offer = await Offer.findById(offerId).lean();
  if (!offer || offer.status !== 'accepted' || String(offer.buyer) !== String(buyerId) || String(offer.listing) !== String(listingId)) return null;
  if (offer.expiresAt && new Date(offer.expiresAt) < new Date()) return null;
  return offer;
};
// many at once (checkout): Map listingId → offer, one query
exports.usableOffers = async (offerByListing, buyerId) => {
  const ids = [...offerByListing.values()].filter(isId);
  const out = new Map();
  if (!ids.length) return out;
  const now = new Date();
  for (const offer of await Offer.find({ _id: { $in: ids } }).lean()) {
    const lid = String(offer.listing);
    if (String(offerByListing.get(lid)) !== String(offer._id)) continue;
    if (offer.status !== 'accepted' || String(offer.buyer) !== String(buyerId)) continue;
    if (offer.expiresAt && new Date(offer.expiresAt) < now) continue;
    out.set(lid, offer);
  }
  return out;
};
exports.markUsed = (ids) => Offer.updateMany({ _id: { $in: ids } }, { $set: { status: 'used' } });

// POST /api/market/offers { listingId, amount, qty }
exports.makeOffer = asyncHandler(async (req, res) => {
  const me = req.customer;
  const listing = await market.contactableListing(req.body.listingId, me);
  if (listing.status !== 'active') throw httpError('This item is no longer available');
  if (!(listing.price > 0)) throw httpError('This ad has no price yet. Ask the seller in the chat instead.');
  const amount = whole(req.body.amount);
  const qty = Math.max(1, Math.min(listing.buyNow ? listing.stock || 1 : 1, Math.round(Number(req.body.qty || 1))));
  if (!(amount > 0)) throw httpError('Please enter your offer in shillings');
  if (amount >= listing.price) throw httpError(`That’s the asking price or more. ${listing.buyNow ? 'Just buy it now!' : 'Tell the seller in the chat.'}`);
  if (amount < Math.ceil(listing.price * 0.3)) throw httpError(`That’s too low: offers must be at least ${ksh(Math.ceil(listing.price * 0.3))} (30% of the price)`);

  const { conv } = await market.ensureConversation(listing, me, `Offer ${ksh(amount)}`);
  // one open offer per buyer and ad: a new amount replaces the old one
  let offer = await Offer.findOne({ listing: listing._id, buyer: me._id, status: { $in: ['pending', 'countered'] } });
  if (offer) {
    offer.amount = amount;
    offer.qty = qty;
    offer.status = 'pending';
    offer.history.push({ by: 'buyer', action: 'offer', amount });
    await offer.save();
  } else {
    offer = await Offer.create({ listing: listing._id, conversation: conv._id, buyer: me._id, seller: listing.seller, listingPrice: listing.price, amount, qty, history: [{ by: 'buyer', action: 'offer', amount }] });
  }
  const text = `💰 Offer: ${ksh(amount)}${qty > 1 ? ` each for ${qty}` : ''} (asking ${ksh(listing.price)})`;
  const { msg } = await market.addMessage(conv, me, text, { kind: 'offer', offer: offer._id });
  res.status(201).json({ offer: offerView(offer), conversationId: conv._id, messageId: msg._id });
});

// POST /api/market/offers/:id { action: 'accept' | 'decline' | 'counter' | 'withdraw', amount }
exports.respond = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Offer not found', 404);
  const offer = await Offer.findById(req.params.id);
  const me = String(req.customer._id);
  if (!offer || (String(offer.buyer) !== me && String(offer.seller) !== me)) throw httpError('Offer not found', 404);
  const role = String(offer.seller) === me ? 'seller' : 'buyer';
  const action = req.body.action;
  // whose turn it is: pending → seller answers · countered → buyer answers
  const turn = offer.status === 'pending' ? 'seller' : offer.status === 'countered' ? 'buyer' : null;
  let text;
  if (action === 'withdraw') {
    if (role !== 'buyer' || !['pending', 'countered'].includes(offer.status)) throw httpError('This offer can’t be withdrawn now');
    offer.status = 'withdrawn';
    text = `↩️ Offer of ${ksh(offer.amount)} withdrawn`;
  } else {
    if (turn !== role) throw httpError(offer.status === 'pending' || offer.status === 'countered' ? 'Waiting for the other person to answer' : `This offer is already ${offer.status}`, 409);
    if (action === 'accept') {
      offer.status = 'accepted';
      offer.acceptedAt = new Date();
      offer.expiresAt = new Date(Date.now() + ACCEPT_HOURS * 3600000);
      const listing = await require('../models/Listing').findById(offer.listing).select('buyNow').lean();
      text = `🤝 Deal! ${role === 'seller' ? 'Seller' : 'Buyer'} accepted ${ksh(offer.amount)}.${listing?.buyNow ? ' Buy it at this price within 48 hours.' : ' Agree on where to meet and pay on collection.'}`;
    } else if (action === 'decline') {
      offer.status = 'declined';
      text = `✖️ ${role === 'seller' ? 'Seller' : 'Buyer'} declined ${ksh(offer.amount)}`;
    } else if (action === 'counter') {
      if (role !== 'seller') throw httpError('Make a new offer instead');
      const amount = whole(req.body.amount);
      if (!(amount > offer.amount)) throw httpError(`Your counter-offer must be more than ${ksh(offer.amount)}`);
      if (offer.listingPrice && amount >= offer.listingPrice) throw httpError(`Your counter-offer must be below your price of ${ksh(offer.listingPrice)}`);
      offer.amount = amount;
      offer.status = 'countered';
      text = `🔁 Seller countered: ${ksh(amount)}`;
    } else throw httpError('Unknown action');
  }
  offer.history.push({ by: role, action, amount: offer.amount });
  await offer.save();
  const conv = await Conversation.findById(offer.conversation);
  if (conv) await market.addMessage(conv, req.customer, text, { kind: 'system', offer: offer._id });
  res.json(offerView(offer));
});

// POST /api/market/offers/agree { conversationId, amount, qty, delivery: { pickup, available, fee } }
// The seller sets the price they agreed with this buyer (in the chat or on the phone). The buyer gets
// "Add to cart at KSh …" and pays through the site, at that price, within 48 hours.
exports.agree = asyncHandler(async (req, res) => {
  const me = req.customer;
  if (!isId(req.body.conversationId)) throw httpError('Conversation not found', 404);
  const conv = await Conversation.findById(req.body.conversationId);
  if (!conv || String(conv.seller) !== String(me._id)) throw httpError('Only the seller can set the agreed price', 403);
  const listing = await require('../models/Listing').findById(conv.listing).lean();
  if (!listing || listing.status !== 'active') throw httpError('This ad is no longer available');
  const { canBuyNow } = require('./orderController');
  if (listing.attrs?.rx === 'Prescription needed') throw httpError('Prescription medicines can’t be paid for on the site. The buyer brings their prescription to your chemist.');
  if (!canBuyNow(listing.category, listing.sub)) throw httpError('Vehicles, land and services can’t be paid for on the site. Agree where to meet in the chat.');
  const amount = whole(req.body.amount);
  if (!(amount > 0)) throw httpError('Enter the price you agreed, in shillings');
  if (listing.price > 0 && amount > listing.price) throw httpError(`The agreed price can’t be more than your ad’s price (${ksh(listing.price)})`);
  const maxQty = listing.buyNow ? listing.stock || 0 : 100;
  const qty = Math.round(Number(req.body.qty || 1));
  if (listing.buyNow && maxQty < 1) throw httpError('This item is out of stock. Add stock to your ad first.');
  if (!(qty >= 1 && qty <= maxQty)) throw httpError(listing.buyNow ? `You have ${maxQty} in stock` : 'Quantity must be between 1 and 100');
  let delivery;
  if (!listing.buyNow) {
    const currentDelivery = req.body.delivery || {};
    const pickup = currentDelivery.pickup !== false && currentDelivery.pickup !== 'false';
    const available = currentDelivery.available === true || currentDelivery.available === 'true';
    const fee = available ? Math.min(50000, Math.max(0, whole(currentDelivery.fee) || 0)) : 0;
    if (!pickup && !available) throw httpError('Choose how the buyer gets it: pickup, delivery, or both');
    delivery = { pickup, available, fee };
  }
  // any open offer from this buyer on this ad is settled by this price
  let offer = await Offer.findOne({ listing: listing._id, buyer: conv.buyer, status: { $in: ['pending', 'countered', 'accepted'] } });
  if (!offer) offer = new Offer({ listing: listing._id, conversation: conv._id, buyer: conv.buyer, seller: me._id, listingPrice: listing.price, history: [] });
  Object.assign(offer, { amount, qty, status: 'accepted', acceptedAt: new Date(), expiresAt: new Date(Date.now() + ACCEPT_HOURS * 3600000), listingPrice: listing.price, ...(delivery ? { delivery } : {}) });
  offer.history.push({ by: 'seller', action: 'agree', amount });
  await offer.save();
  const how = delivery ? ` ${[delivery.pickup ? 'Pick up' : '', delivery.available ? `${delivery.pickup ? 'delivery' : 'Delivery'} ${delivery.fee ? ksh(delivery.fee) : 'free'}` : ''].filter(Boolean).join(' or ')}.` : '';
  const text = `🤝 Agreed price: ${ksh(amount)}${qty > 1 ? ` each for ${qty}` : ''}.${how} Tap “Add to cart” to buy at this price within 48 hours.`;
  await market.addMessage(conv, me, text, { kind: 'offer', offer: offer._id });
  res.status(201).json(offerView(offer));
});

// GET /api/market/offers/:id
exports.get = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError('Offer not found', 404);
  const offer = await Offer.findById(req.params.id).lean();
  const me = String(req.customer._id);
  if (!offer || (String(offer.buyer) !== me && String(offer.seller) !== me)) throw httpError('Offer not found', 404);
  res.json(offerView(offer));
});

// GET /api/market/offers/for/:listingId  (my latest offer on this ad, for the ad page)
exports.mineFor = asyncHandler(async (req, res) => {
  if (!isId(req.params.listingId)) return res.json(null);
  const offer = await Offer.findOne({ listing: req.params.listingId, buyer: req.customer._id }).sort({ updatedAt: -1 }).lean();
  res.json(offer ? { ...offerView(offer), conversation: offer.conversation } : null);
});
