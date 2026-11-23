// Secure HTTP headers (helmet) with a strict Content-Security-Policy, and CORS limited to our own sites.
const crypto = require('crypto');
const helmet = require('helmet');
const cors = require('cors');
const { allowedOrigins } = require('./csrf');

// A fresh nonce per page: only our own <script> tags run (plus what they load: 'strict-dynamic').
function nonce(req, res, next) {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  // our HTML pages get the nonce on every inline/module <script> just before they are sent
  const send = res.send.bind(res);
  res.send = (body) => {
    if (typeof body === 'string' && body.includes('<script') && /^\s*<!doctype html|^\s*<html/i.test(body)) {
      body = body.replace(/<script(?![^>]*\bnonce=)/gi, `<script nonce="${res.locals.cspNonce}"`);
    }
    return send(body);
  };
  next();
}

const headers = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [(req, res) => `'nonce-${res.locals.cspNonce}'`, "'strict-dynamic'", 'https:'], // https: is only a fallback for very old browsers
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'wss:', 'https://maps.googleapis.com', 'https://*.googleapis.com', 'https://accounts.google.com'],
      frameSrc: ['https://www.google.com', 'https://maps.google.com', 'https://accounts.google.com'],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false, // Google Maps / sign-in frames
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // Google sign-in popup
  crossOriginResourcePolicy: { policy: 'same-site' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  strictTransportSecurity: { maxAge: 180 * 24 * 3600, includeSubDomains: false },
  xFrameOptions: { action: 'deny' },
});

// Permissions: the site uses location (delivery address) and nothing else from the device
function extra(req, res, next) {
  res.set('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()');
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store'); // personal data is never cached by browsers or proxies
  next();
}

// CORS: only our own sites may call the API from a browser (same-origin requests need no CORS at all)
const corsMiddleware = cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // same-origin, server-to-server, curl
    cb(null, allowedOrigins().includes(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Staff-Gate'],
  maxAge: 600,
});

// Uploaded photos: served as plain images only, never as a page or a script
function uploadHeaders(req, res, next) {
  if (!/\.(jpe?g|png|webp|gif)$/i.test(req.path)) return res.status(404).end();
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; sandbox", 'Cross-Origin-Resource-Policy': 'cross-origin' });
  next();
}

module.exports = { nonce, headers, extra, corsMiddleware, uploadHeaders };
