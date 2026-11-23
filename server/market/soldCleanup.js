// Sold ads are deleted from the system.
//  - The seller taps "Mark as sold" → the ad is deleted at once.
//  - An ad that is sold but still has a sale in progress (an order not yet delivered, an agreement or a Lipa Pole Pole
//    plan still running) waits: if that sale is cancelled the ad goes back on sale. It is deleted as soon as the
//    sale is done (checked after each delivery and every 10 minutes).
// Photos still shown in past orders or chats are kept; the rest are deleted with the ad. Old orders, receipts and
// chats keep their own copy of the title, price and photo, so nothing breaks.
const Listing = require('../models/Listing');
const { invalidate } = require('../utils/cache');
const { removeListingImage } = require('../middleware/upload');

const OPEN_ORDER = ['awaiting_payment', 'placed', 'confirmed', 'shipped'];

// which of these ads still have a sale in progress
async function inProgress(ids) {
  if (!ids.length) return new Set();
  const Order = require('../models/Order');
  const Agreement = require('../models/Agreement');
  const Plan = require('../models/Plan');
  const [values, currentValues, valuesItem] = await Promise.all([
    Order.distinct('items.listing', { 'items.listing': { $in: ids }, status: { $in: OPEN_ORDER } }),
    Agreement.distinct('listing', { listing: { $in: ids }, status: { $in: ['waiting_buyer', 'waiting_seller', 'active'] } }),
    Plan.distinct('listing', { listing: { $in: ids }, status: { $in: ['pending_deposit', 'active'] } }),
  ]);
  return new Set([...values, ...currentValues, ...valuesItem].map(String));
}

// delete sold ads (all of them, or the ones matching `filter`) that have no sale in progress
async function purgeSold(filter = {}) {
  const sold = await Listing.find({ ...filter, status: 'sold' }).select('_id images').lean();
  if (!sold.length) return { deleted: 0, waiting: 0, ids: [] };
  const busy = await inProgress(sold.map((item) => item._id));
  const go = sold.filter((item) => !busy.has(String(item._id)));
  if (go.length) {
    const ids = go.map((item) => item._id);
    const images = go.flatMap((item) => item.images || []);
    if (images.length) {
      const Order = require('../models/Order');
      const Conversation = require('../models/Conversation');
      const [inOrders, inChats] = await Promise.all([
        Order.distinct('items.image', { 'items.image': { $in: images } }),
        Conversation.distinct('listingImage', { listingImage: { $in: images } }),
      ]);
      const keep = new Set([...inOrders, ...inChats]);
      for (const img of images) if (!keep.has(img)) removeListingImage(img);
    }
    await Listing.deleteMany({ _id: { $in: ids }, status: 'sold' });
    // open price offers on those ads can't go anywhere now
    await require('../models/Offer').updateMany({ listing: { $in: ids }, status: { $in: ['pending', 'countered', 'accepted'] } }, { $set: { status: 'expired' } });
    invalidate('market:');
  }
  return { deleted: go.length, waiting: busy.size, ids: go.map((item) => String(item._id)) };
}

function start() {
  const run = () => purgeSold().then((result) => result.deleted && console.log(`Sold ads removed: ${result.deleted}`)).catch((error) => console.error('Sold ads cleanup:', error.message));
  const once = require('../utils/jobs').every('sold-cleanup', 10 * 60 * 1000, run); // one server at a time
  setTimeout(once, 15 * 1000); // shortly after start-up
}

module.exports = { purgeSold, inProgress, start };
