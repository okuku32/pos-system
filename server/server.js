require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const connectDB = require('./config/db');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();
app.set('trust proxy', 1); // behind ngrok / a reverse proxy: needed for correct client IPs in rate limiting

app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json());
app.use(morgan('dev'));

// Uploaded product images (public, cached for a week; filenames are random so they never go stale)
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '7d', fallthrough: false }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
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
app.use('/api', notFound);

// Serve the built React app in production
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '../client/dist');
  app.use(express.static(dist));
  app.get(/.*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
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
  .then(() => require('./utils/saleService').backfillSaleCosts())
  .then(() => require('./models/Customer').syncIndexes())
  .then(() => require('./utils/etims').startWorker())
  .catch((err) => console.error('Start-up data check failed:', err.message));
