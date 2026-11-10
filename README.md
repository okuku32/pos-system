# Ordersasa: MERN POS & online shop

A point-of-sale system and customer-facing online shop for a Kenyan retail store, built with **MongoDB, Express, React (Vite) and Node.js**. It takes payments by **M-Pesa (Daraja STK Push)** or cash, reports sales to **KRA eTIMS**, and keeps staff and customers updated in real time.

## Features

**Point of sale (staff)**
- Product grid with categories, search and barcode scanning; cash and M-Pesa checkout with printable receipts
- Product discounts (crossed-out prices, "customer saves" on receipts) and an optional extra discount
- "Today" bar with total sales, transactions, discounts and (admins only) profit, updated live across tills
- Customer orders: save now, pay later; pickup and delivery with live stages (accepted, preparing, ready / out for delivery)
- Real-time alerts for new online orders and support messages (sound, pop-up, desktop notification)
- Customer support inbox with quick replies
- Reports: revenue, cost, profit and margin; breakdowns by product, category, cashier, payment and day; stock remaining after sales, including units held in open orders; CSV export
- Roles: admin and cashier (cashiers never see cost prices or profit)

**Online shop (customers)**
- Browse products with pictures, discounts and live stock; slide-in cart
- Sign up / log in with email and password **or Google (OAuth)**
- Place pickup or delivery orders and track them live, with timeline and delivery ETA countdown
- Email notifications: order received, dispatched / ready for pickup, payment received, cancelled
- Support chat that works without an account; Help page with the shop location (Imara Mall, Mombasa Road, Nairobi)

**Integrations**
- **M-Pesa Daraja:** STK Push with callback plus status polling (works even without a public callback URL)
- **KRA eTIMS (OSCU):** each sale sent as a tax invoice with per-product VAT type; KRA signature and verification QR code on the receipt; automatic retries; test mode for development
- **Email:** any SMTP provider (Gmail, Zoho, Brevo…); free Ethereal test inbox in development
- **Google sign-in:** Google Identity Services, verified on the server

## Tech stack
React 19 + Vite · Express 5 · MongoDB + Mongoose · Socket.IO · Nodemailer · google-auth-library · axios

## Getting started

Requirements: **Node.js 18+** and **MongoDB** (local install or MongoDB Atlas).

```bash
git clone <this-repo-url>
cd Pos-system
npm run install-all                 # installs root, server and client dependencies
cp server/.env.example server/.env  # then edit server/.env
cp client/.env.example client/.env
npm run seed                        # optional: demo products + admin/cashier users
npm run dev                         # API on :5000, app on http://localhost:5173
```

Demo logins after seeding: `admin@pos.com` / `admin123` and `cashier@pos.com` / `cashier123`. **Change these before real use.**

- Staff POS: http://localhost:5173
- Customer shop: http://localhost:5173/shop

## Configuration (`server/.env`)

| Setting | Purpose |
|---|---|
| `MONGO_URI`, `JWT_SECRET` | Database connection and login token secret (use a long random string) |
| `MPESA_*` | Daraja keys. `MPESA_CALLBACK_URL` must be a public HTTPS URL (e.g. via ngrok) |
| `SHOP_URL`, `MAIL_FROM`, `SMTP_*` | Customer emails. Leave `SMTP_HOST` empty to use an Ethereal test inbox |
| `GOOGLE_CLIENT_ID` | Google sign-in (OAuth client ID, type "Web application"). Leave empty to hide the button |
| `ETIMS_MODE` (`off`, `mock`, `sandbox`, `live`), `ETIMS_TIN`, `ETIMS_BHF_ID`, `ETIMS_DEVICE_SERIAL` | KRA eTIMS. In `mock` mode, receipts are marked as test invoices |

Shop location and contact details shown to customers are in `client/src/shop/storeInfo.js`.

### M-Pesa callbacks in development
```bash
ngrok http 5000
# then set MPESA_CALLBACK_URL=https://<your-domain>.ngrok-free.app/api/mpesa/callback
```

### Going live with eTIMS
Register for eTIMS (OSCU) with KRA, fill in your sandbox PIN, branch ID and device serial, set `ETIMS_MODE=sandbox`, restart, then use **Settings → KRA eTIMS → Initialise device** and make test sales. Switch to `ETIMS_MODE=live` once KRA approves. The integration follows KRA's published OSCU API; confirm field codes against KRA's current specification.

## Production
```bash
npm run build                 # builds client/dist
# set NODE_ENV=production in server/.env
npm start                     # Express serves the API and the built React app
```

## Project structure
```
client/            React app (Vite)
  src/pages/       Staff POS screens
  src/shop/        Customer shop (Ordersasa)
server/            Express API
  models/          Mongoose models
  controllers/     Route handlers
  utils/           M-Pesa, eTIMS, email, pricing, real-time
```

## Security notes
- Never commit `server/.env`; it holds your keys. `.gitignore` excludes it, along with `node_modules`, build output and uploaded pictures.
- Prices, discounts and stock are always decided on the server; customer and staff logins are separate.
