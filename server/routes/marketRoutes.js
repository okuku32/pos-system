const router = require('express').Router();
require('../security/sanitize').guardIds(router); // :id parameters must be database ids
const { rateLimit } = require('express-rate-limit');
const marketController = require('../controllers/marketController');
const trust = require('../controllers/trustController');
const offers = require('../controllers/offerController');
const boosts = require('../controllers/boostController');
const { protectCustomer, optionalCustomer } = require('../middleware/customerAuth');
const { protect, can } = require('../middleware/auth');
const { listingImages } = require('../middleware/upload');

const limit = (windowMs, number, message) =>
  rateLimit({ ...require('../security/rateStore')(), windowMs, limit: number, standardHeaders: 'draft-8', legacyHeaders: false, message: { message } });
const browse = limit(60 * 1000, 240, 'Too many requests. Please slow down a little.');
const posting = limit(60 * 60 * 1000, 300, 'You’ve posted a lot of ads in a short time. Please wait a few minutes and try again.'); // no cap on how many ads; this only slows spam bots
const chatting = limit(60 * 1000, 40, 'You’re sending messages too fast. Please wait a moment.');
const reveal = limit(60 * 60 * 1000, 60, 'Too many phone number requests. Please use chat instead.');
// a seller's number is only for signed-in people: never kept by a browser, proxy or CDN (so it can't be seen again
// after logging out, or by the next person on a shared phone or computer)
const privateContact = (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  res.vary('Cookie');
  res.vary('Authorization');
  next();
};

// ----- public (anyone can browse and search)
router.get('/categories', browse, marketController.categories);
router.get('/home', browse, marketController.home);
router.get('/about-stats', browse, marketController.aboutStats); // the About page's live figures
router.get('/suggest', browse, marketController.suggest);
router.get('/listings', browse, marketController.list);
// AI search ("cheapest Samsung phone under 20k"): fewer per minute, the AI costs money
router.get('/ai-search', limit(60 * 1000, 20, 'Too many AI searches. Please wait a minute.'), optionalCustomer, marketController.aiSearch);
router.get('/ai-trends', limit(60 * 1000, 20, 'Too many questions. Please wait a minute.'), optionalCustomer, marketController.aiTrends);
router.get('/listings/:slug', browse, optionalCustomer, marketController.get);
router.get('/sellers-near', browse, marketController.sellersNear);
router.get('/sellers/:id/contact', privateContact, reveal, protectCustomer, marketController.sellerContact);
router.get('/fashion', browse, marketController.fashion);
router.post('/cart-check', browse, marketController.cartCheck);
router.get('/sellers/:id/basket', browse, marketController.basket);
router.get('/delivery-quote', browse, marketController.deliveryQuote);
router.get('/markets', browse, optionalCustomer, marketController.markets);
router.get('/markets/:slug', browse, marketController.market);
router.get('/markets/:slug/agents', privateContact, browse, optionalCustomer, marketController.marketAgents); // phones only for signed-in members
router.get('/sellers/:id', browse, marketController.seller);
router.get('/sellers/:id/stores', browse, marketController.sellerStores);
router.get('/products', browse, marketController.productSuggest); // the catalogue: one product, many sellers
router.get('/products/:id', browse, marketController.product);
router.get('/presence', browse, marketController.presence);
router.get('/importers', browse, marketController.importers); // ?q=chinese latest importer → traders with matching goods + their latest items // ?ids=a,b,c → online / last seen (sellers only)
router.get('/sellers/:id/reviews', browse, trust.sellerReviews);
router.get('/price-guide', browse, marketController.priceGuide);
router.get('/boosts/plans', browse, boosts.plans);

// ----- staff moderation (must come before the customer routes below)
// 📸 photo requests: a buyer sends a seller a photo of an item that isn't in their ads (private photos)
const photoRequests = require('../controllers/photoRequestController');
const photoSending = limit(60 * 60 * 1000, 30, 'You’ve sent many photo requests. Please wait a little.');
router.post('/photo-requests', photoSending, protectCustomer, photoRequests.upload, photoRequests.create);
router.get('/photo-requests', protectCustomer, photoRequests.mine);
router.get('/photo-requests/:id/photos/:n', protectCustomer, photoRequests.photo);
router.post('/photo-requests/:id/answer', protectCustomer, photoRequests.answer);
router.post('/photo-requests/:id/cancel', protectCustomer, photoRequests.cancel);
router.get('/admin/photo-requests', protect, can('orders'), photoRequests.adminList);
router.get('/admin/photo-requests/:id/photos/:n', protect, can('orders'), photoRequests.adminPhoto);
router.get('/admin/listings', protect, can('ads'), marketController.adminList);
router.patch('/admin/listings/:id', protect, can('ads'), marketController.adminSetStatus);
router.delete('/admin/listings/:id', protect, can('ads'), marketController.adminRemove);
router.get('/admin/markets', protect, can('sellers'), marketController.adminMarkets);
router.post('/admin/markets', protect, can('sellers'), marketController.adminCreateMarket);
router.put('/admin/markets/:id', protect, can('sellers'), marketController.adminUpdateMarket);
router.delete('/admin/markets/:id', protect, can('sellers'), marketController.adminDeleteMarket);

// ----- logged-in customers: sell, manage, report, chat
router.get('/listings/:id/phone', privateContact, reveal, protectCustomer, marketController.phone);
// after a change succeeds, refresh that person's rows in the people tables
const refreshPerson = (pick) => (req, res, next) => {
  res.on('finish', () => { if (res.statusCode < 400) require('../market/directory').touch(pick(req)); });
  next();
};
const me = refreshPerson((req) => req.customer?._id);
router.post('/listings', posting, protectCustomer, me, listingImages, marketController.create);
router.put('/listings/:id', protectCustomer, me, listingImages, marketController.update);
router.patch('/listings/:id/status', protectCustomer, me, marketController.setStatus);
router.patch('/listings/:id/price', protectCustomer, me, marketController.quickPrice); // today's price / unit, in one tap
router.delete('/listings/:id', protectCustomer, me, marketController.remove);
router.post('/listings/:id/report', protectCustomer, marketController.report);
router.get('/mine', protectCustomer, marketController.mine);
router.post('/markets', limit(60 * 60 * 1000, 5, 'Too many market suggestions. Please try again later.'), protectCustomer, marketController.suggestMarket);
router.get('/mine/:id', protectCustomer, marketController.mineOne);

router.get('/conversations', protectCustomer, marketController.conversations);
router.get('/conversations/unread', protectCustomer, marketController.unread);
router.post('/conversations', chatting, protectCustomer, marketController.startChat);
router.get('/conversations/:id/messages', protectCustomer, marketController.messages);
router.post('/conversations/:id/messages', chatting, protectCustomer, marketController.send);
router.post('/conversations/:id/read', protectCustomer, marketController.markRead);

// bargaining, site visits, review replies, paid boosts
router.post('/offers', chatting, protectCustomer, offers.makeOffer);
router.post('/offers/agree', chatting, protectCustomer, offers.agree);
router.get('/offers/for/:listingId', protectCustomer, offers.mineFor);
router.get('/offers/:id', protectCustomer, offers.get);
router.post('/offers/:id', chatting, protectCustomer, offers.respond);
router.post('/visits', chatting, protectCustomer, marketController.requestVisit);
router.post('/visits/:messageId', protectCustomer, marketController.answerVisit);
router.post('/reviews/:id/reply', protectCustomer, trust.replyReview);
router.get('/boosts', protectCustomer, boosts.mine);
router.post('/boosts', limit(10 * 60 * 1000, 10, 'Too many payment attempts. Please wait a few minutes.'), protectCustomer, boosts.create);
router.get('/boosts/:id', protectCustomer, boosts.get);

module.exports = router;
