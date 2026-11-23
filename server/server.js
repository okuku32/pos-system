require('dotenv').config();
const http = require('http');
const express = require('express');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');
const connectDB = require('./config/db');
const { loadSite, publicSite } = require('./config/site');
const { notFound, errorHandler } = require('./middleware/error');

// Kapu marketplace: buyers and sellers post ads, search, chat, and buy online (M-Pesa or cash on delivery).
const app = express();
// how many proxies stand in front of us (for each visitor's real IP, used by rate limits and the audit log):
// 1 = one (ngrok, Render, Nginx) · 2 = the app on Vercel forwarding to this server on Render (Vercel + Render's own)
app.set('trust proxy', Math.min(5, Math.max(1, Number(process.env.TRUST_PROXY_HOPS) || 1)));
app.disable('x-powered-by');
// plain http reaching us through the proxy (ngrok / a load balancer) is sent to https first: cookies only travel over HTTPS
app.use((req, res, next) => {
  if (req.get('x-forwarded-proto') === 'http' && process.env.FORCE_HTTPS !== 'false') return res.redirect(308, `https://${req.get('host')}${req.originalUrl}`);
  next();
});

// ---------------------------------------------------------------- security (see server/security/)
const security = require('./security/headers');
const { csrfGuard } = require('./security/csrf');
const { sanitizeRequest } = require('./security/sanitize');
const { auditTrail } = require('./security/audit');
const { checkEnv, redactUrl } = require('./security/env');
checkEnv(); // stops a production server that has a weak / missing JWT_SECRET

app.use(compression()); // gzip every response: far smaller downloads
app.use(security.nonce); // a fresh nonce for the page's own <script> tags
app.use(security.headers); // CSP, HSTS, frame / sniffing / referrer protection
app.use(security.extra);
app.use('/api', security.corsMiddleware); // only our own sites may call the API from a browser
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
morgan.token('safe-url', (req) => redactUrl(req.originalUrl));
app.use(morgan(':method :safe-url :status :response-time ms - :res[content-length]')); // no tokens or keys in the log
app.use(sanitizeRequest); // NoSQL operators, prototype pollution, HTML / script in text
app.use(csrfGuard); // origin check + CSRF token for cookie logins
app.use(auditTrail); // staff changes and refused requests go to the audit log

// Ad photos (public, cached for a week; filenames are random so they never go stale). Images only, never run.
app.use('/uploads', security.uploadHeaders, express.static(require('./config/storage').UPLOADS_DIR, { maxAge: '365d', immutable: true, fallthrough: false, dotfiles: 'deny', index: false })); // random names that never change: kept a year (browsers and the CDN)

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/site', (req, res) => res.json(publicSite())); // name, contacts, address for the website
app.use('/api/auth', require('./routes/authRoutes')); // admin / moderator logins and team
app.use('/api/admin', require('./routes/adminRoutes')); // dashboard numbers and settings
app.use('/api/customers', require('./routes/customerRoutes')); // buyer & seller accounts
app.use('/api/market', require('./routes/marketRoutes')); // ads, search, buyer-seller chat
app.use('/api/orders', require('./routes/orderRoutes')); // "Buy now" orders, checkout, payouts
app.use('/api/seller', require('./routes/sellerRoutes')); // Seller hub: stores, inventory, sales & earnings
app.use('/api/geo', require('./routes/geoRoutes')); // address suggestions & road distances (Google Places + Routes)
app.use('/api/plans', require('./routes/planRoutes')); // Lipa Pole Pole (pay in instalments)
app.use('/api/agreements', require('./routes/agreementRoutes')); // Lipa Pole Pole sale agreements (nearby furniture)
app.use('/api/mpesa', require('./routes/mpesaRoutes')); // Safaricom payment results
app.use('/api/support', require('./routes/supportRoutes')); // help chat with the marketplace team
app.use('/api/work', require('./routes/workRoutes')); // riders & shopping agents
app.use('/api/errands', require('./routes/errandRoutes')); // book a rider or shopping agent directly (no seller)
app.use('/api/reviews', require('./routes/platformReviewRoutes')); // ⭐ "Rate Kapu": public reviews of the platform
app.use('/api/notifications', require('./routes/notificationRoutes')); // 🔔 live notifications (English & Kiswahili)
app.use('/api', notFound);

const serveClient = process.env.NODE_ENV === 'production' || process.env.SERVE_CLIENT === 'true';
if (!serveClient) app.use(require('./market/seo').seoRouter(null)); // robots.txt and sitemap.xml while developing

app.use((req, res, next) => {
  if (/^\/(staff|admin)(\/|$)/.test(req.path)) res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
  next();
});

// Serve the built React app (production, or SERVE_CLIENT=true to share it through ngrok)
if (serveClient) {
  const dist = path.join(__dirname, '../client/dist');
  // Built files have a content hash in their name, so browsers can keep them for a year;
  // index.html is always re-checked so a new release is picked up immediately.
  app.use('/assets', express.static(path.join(dist, 'assets'), { maxAge: '365d', immutable: true }));
  app.use('/fonts', express.static(path.join(dist, 'fonts'), { maxAge: '365d', immutable: true })); // self-hosted fonts (versioned names)
  // Search-engine friendly pages (titles, descriptions, structured data, readable HTML)
  app.use(require('./market/seo').seoRouter(dist));
  app.use(express.static(dist, { maxAge: 0, index: false }));
  app.get(/.*/, (req, res) => {
    res.set('Cache-Control', 'no-cache');
    const html = require('./market/seo').appPage(dist);
    if (html) res.type('html').send(html);
    else res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use(errorHandler);

const PORT = process.env.PORT || 5000;
// Start listening straight away so the website never hits a closed port during start-up.
// Mongoose queues any database queries made before the connection is ready.
const server = http.createServer(app);
require('./utils/realtime').init(server);
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use: another copy of the server is probably running.`);
    console.error('Close the other terminal running "npm run dev" (or stop it with Ctrl+C) and try again.\n');
    process.exit(1);
  }
  throw err;
});
server.listen(PORT, () => console.log(`Kapu marketplace server running on port ${PORT} (real-time enabled)`));

connectDB()
  .then(() => loadSite())
  .then(async () => {
    await require('./middleware/staffGate').loadGate();
    // staff accounts still on a well-known default password must pick a new one at their next sign-in
    const User = require('./models/User');
    const weak = [];
    for (const user of await User.find({ mustChangePassword: { $ne: true } }).select('+password')) {
      for (const item of ['admin123', 'cashier123', 'password', '123456', 'admin1234']) {
        if (await user.matchPassword(item)) {
          weak.push(user._id);
          break;
        }
      }
    }
    if (weak.length) await User.updateMany({ _id: { $in: weak } }, { $set: { mustChangePassword: true } }); // one write
    // before owners existed: the longest-serving active admin becomes the owner (once; logged in the audit trail)
    if (!(await User.exists({ role: 'owner', active: true }))) {
      const firstAdmin = await User.findOne({ role: 'admin', active: true }).sort('createdAt');
      if (firstAdmin) {
        firstAdmin.role = 'owner';
        await firstAdmin.save();
        console.log(`Staff: ${firstAdmin.email} is now the owner (the first admin).`);
        require('./models/StaffEvent').create({ user: firstAdmin._id, email: firstAdmin.email, name: firstAdmin.name, action: 'user_updated', detail: 'role → owner (first admin, automatic)' }).catch(() => {});
      }
    }
    // older staff accounts (before areas existed) can do everything a moderator could before
    await User.updateMany({ perms: { $exists: false } }, { $set: { perms: User.PERMS } });
  })
  .then(async () => {
    // one-time tidy-ups for databases from the earlier POS version
    const User = require('./models/User');
    await User.collection.updateMany({ role: { $nin: ['admin', 'moderator'] } }, { $set: { role: 'moderator' } });
    await require('./models/Customer').syncIndexes();
    // accounts from before email verification existed keep working (new sign-ups start unverified)
    await require('./models/Customer').updateMany({ emailVerified: { $exists: false } }, { $set: { emailVerified: true } });
    await require('./models/Listing').syncIndexes();
    await require('./models/Order').syncIndexes();
    await require('./models/Plan').syncIndexes();
    await require('./models/Market').syncIndexes();
    await require('./models/Task').syncIndexes();
    for (const item of ['Notification', 'Conversation', 'ChatMessage', 'Review', 'Offer', 'Agreement', 'Boost', 'Payout', 'Job', 'PushDevice', 'PickupPoint', 'Errand', 'Store', 'Product', 'Delivery', 'AgentSeller']) {
      try {
        await require(`./models/${item}`).syncIndexes();
      } catch (error) {
        console.error(`Indexes for ${item}:`, error.message);
      }
    }
    await require('./market/markets').ensureMarkets(require('./models/Market'));
    await require('./market/pickupPoints').ensureStarters(); // Shop & ride: a starter set of pickup points (CBD hub + areas)
    // sellers' main stores (from their shop location) and the product catalogue, for data from before they existed
    try {
      await require('./market/stores').backfill();
      await require('./market/catalog').backfill();
    } catch (error) {
      console.error('Stores / catalogue backfill:', error.message);
    }
    // the people tables (buyers, retailers, wholesalers, importers, riders, shopping agents)
    for (const value of Object.values(require('./models/Directory'))) await value.syncIndexes();
    require('./market/directory').start();
    // clothing ads posted before "Type" existed get one from their title (Shirts, Dresses, Watches…)
    const { ITEMS, guessItem } = require('./market/categories');
    const Listing = require('./models/Listing');
    const typed = [];
    for (const listing of await Listing.find({ sub: { $in: Object.keys(ITEMS) }, 'attrs.item': { $exists: false } }).select('sub title description attrs').lean()) {
      let item = guessItem(listing.sub, listing.title);
      if (item === 'Other') item = guessItem(listing.sub, `${listing.title} ${listing.description}`);
      if (item === 'Men’s watches' && listing.attrs?.gender === 'Women') item = 'Women’s watches';
      typed.push({ updateOne: { filter: { _id: listing._id }, update: { $set: { 'attrs.item': item } } } });
    }
    if (typed.length) await Listing.bulkWrite(typed, { ordered: false }); // one write
  })
  .then(() => {
    require('./controllers/orderController').startExpiryWorker();
    require('./controllers/boostController').startBoostWorker();
    require('./controllers/workController').startWorkWorker();
    require('./controllers/planController').startPlanWorker();
    require('./market/soldCleanup').start(); // sold ads are deleted once their sale is done
    // background queue: emails (and other slow work) are sent outside the request, retried if they fail
    require('./utils/mailer').startMailWorker();
    require('./utils/push').startPushWorker(); // 📲 Android push (Firebase), when configured
    require('./utils/jobs').start();
  })
  .catch((err) => console.error('Start-up data check failed:', err.message));

// ---------------------------------------------------------------- graceful shutdown (deploys, scaling down)
// stop taking new connections, let running requests and the current background job finish, then close the
// database and Redis. A load balancer moves visitors to the other servers in the meantime.
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: shutting down gracefully…`);
  const force = setTimeout(() => process.exit(1), 15000);
  force.unref();
  try {
    await require('./utils/jobs').stop();
    await new Promise((resolve) => server.close(resolve));
    await require('./utils/redis').quit();
    await require('mongoose').connection.close();
  } catch (error) {
    console.error('Shutdown:', error.message);
  }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
