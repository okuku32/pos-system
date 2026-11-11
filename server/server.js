require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');
const connectDB = require('./config/db');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();
app.set('trust proxy', 1); // behind ngrok / a reverse proxy: needed for correct client IPs in rate limiting

app.use(compression()); // gzip every response (JSON, JS, CSS): far smaller downloads
app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json());
app.use(morgan('dev'));

// Uploaded product images (public, cached for a week; filenames are random so they never go stale)
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '7d', fallthrough: false }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Your platform console (manages all clients): not tied to any one client
app.use('/api/platform', require('./routes/platformRoutes'));

// Everything below runs inside ONE client (tenant), chosen from the web address (see tenancy/tenants.js)
const { tenantMiddleware, bootstrapDefaultTenant, forEachTenant } = require('./tenancy/tenants');
app.use('/api', tenantMiddleware());
app.get('/api/shop/info', require('./controllers/tenantSettingsController').publicInfo);
app.use('/api/tenant', require('./routes/tenantRoutes')); // a client's own business settings
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/products', require('./routes/productRoutes'));
app.use('/api/sales', require('./routes/saleRoutes'));
app.use('/api/mpesa', require('./routes/mpesaRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/shop', require('./routes/shopRoutes')); // public: customer ordering
app.use('/api/customers', require('./routes/customerRoutes')); // customer sign-up / login
app.use('/api/settings', require('./routes/settingsRoutes'));
app.use('/api/support', require('./routes/supportRoutes')); // customer support chat
app.use('/api/etims', require('./routes/etimsRoutes')); // KRA eTIMS
app.use('/api/suppliers', require('./routes/supplierRoutes'));
app.use('/api/purchases', require('./routes/purchaseRoutes'));
app.use('/api/expenses', require('./routes/expenseRoutes'));
app.use('/api/market', require('./routes/marketRoutes')); // marketplace: ads, search, buyer-seller chat
app.use('/api', notFound);

// robots.txt and sitemap.xml (always available, also while developing)
if (!(process.env.NODE_ENV === 'production' || process.env.SERVE_CLIENT === 'true')) app.use(require('./market/seo').seoRouter(null));

// Serve the built React app in production
// Also when SERVE_CLIENT=true: lets the backend serve the built app (e.g. to share it through ngrok without the slow dev server)
if (process.env.NODE_ENV === 'production' || process.env.SERVE_CLIENT === 'true') {
  const dist = path.join(__dirname, '../client/dist');
  // Built files have a content hash in their name, so browsers can keep them for a year;
  // index.html is always re-checked so a new release is picked up immediately.
  app.use('/assets', express.static(path.join(dist, 'assets'), { maxAge: '365d', immutable: true }));
  // Search-engine friendly marketplace pages (titles, descriptions, structured data, readable HTML)
  app.use(require('./market/seo').seoRouter(dist));
  app.use(express.static(dist, { maxAge: 0, index: false }));
  app.get(/.*/, (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use(errorHandler);

const PORT = process.env.PORT || 5000;
// Start listening straight away so the frontend never hits a closed port during start-up.
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
server.listen(PORT, () => console.log(`POS server running on port ${PORT} (real-time enabled)`));

connectDB()
  .then(() => bootstrapDefaultTenant()) // first start: the existing shop becomes the first client
  .then(() =>
    forEachTenant(async () => {
      await require('./utils/saleService').backfillSaleCosts();
      await require('./models/Customer').syncIndexes();
      await require('./models/Listing').syncIndexes();
    }, { includeSuspended: true })
  )
  .then(() => require('./utils/etims').startWorker())
  .catch((err) => console.error('Start-up data check failed:', err.message));
