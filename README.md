# Kapu: buy and sell anything in Kenya

A marketplace that connects buyers and sellers, in the style of Jiji and Jumia, built with **MongoDB, Express, React (Vite) and Node.js**.

Anyone can post ads for free: vehicles, land, electronics, furniture, clothes, baby items and more. Buyers can:

- **chat with or call the seller** (Jiji-style), or
- **buy online** (Jumia-style) for items the seller lists with stock, paying with **M-Pesa** or **cash on delivery**.

**Runs everywhere from one React front end:** desktop web, mobile web, installable PWA and a native Android app (Capacitor). Several API servers can run behind a load balancer (Redis). See [docs/PLATFORMS-AND-SCALING.md](docs/PLATFORMS-AND-SCALING.md) for the architecture, the Android build, scaling, security and performance.

## Features

**Buyers**
- Search that forgives partial words, plurals, Swahili words (gari, shamba, simu, nguo) and price phrases ("plot under 1m"), with instant suggestions.
- 20 categories and 145 types, with filters that match each one: make → model for vehicles, size and title deed for land, storage for phones, and so on.
- In-app chat with sellers, live, with an unread badge and an email to the seller about each new conversation.
- Cart and checkout for "Buy online" items:
  - one M-Pesa prompt for the whole cart, or cash on delivery
  - delivery or pickup
  - live order tracking and email updates
- On phones, an app-style bottom bar (Home, Categories, Sell, Chats, Account), a back-to-top button and a full link footer.

**Sellers**
- Post an ad in about 2 minutes, with up to 8 photos (shrunk on the phone before upload).
- Optional "Sell online" with quantity in stock, delivery fee and pickup.
- "Orders to fulfil": confirm, ship (with rider details) and mark delivered. Shows earnings and payouts.
- A public seller page and "My ads" for editing, marking sold and deleting.

**Marketplace team (`/admin`)**
- Dashboard with a "needs attention" list (reported ads, refunds, payouts, support chats).
- Ad moderation: take down, restore or delete; reported ads come first.
- Orders and payouts:
  - M-Pesa money is held until delivery, then paid to the seller minus the commission
  - refunds are recorded for cancelled paid orders
  - CSV export
- Support inbox, team accounts (admin or moderator), and site settings (name, contacts, commission %).

**SEO**
- The server sends real HTML for every ad, category and make/model page, with:
  - title, description and canonical link
  - Open Graph tags for previews on WhatsApp and Facebook
  - Product, Car and Breadcrumb structured data
- `/sitemap.xml` updates automatically and `/robots.txt` is included.

## Getting started

Requirements: **Node.js 18+** and **MongoDB**.

```bash
npm run install-all                          # root, server and client dependencies
cp server/.env.example server/.env           # then fill it in
npm run seed --prefix server                 # first admin: admin@pos.com / admin123
npm run seed:market --prefix server          # optional: ~100 demo ads from 6 demo sellers
npm run dev                                  # API on :5000, website on http://localhost:5173
```

- Marketplace: http://localhost:5173
- Admin: http://localhost:5173/admin
- Demo sellers log in with `wanjiku@demo.kapu.test` (also brian, amina, kevin, faith and moses), password `demo1234`.
- Remove the demo data with `npm run seed:market --prefix server -- --remove`.

## Configuration

Everything is in `server/.env`; see `server/.env.example`. The marketplace name, contacts and commission are edited in **Admin → Settings**.

M-Pesa results arrive at `PUBLIC_API_URL/api/mpesa/callback`. While developing on a laptop without a public address, the checkout also asks Safaricom for the payment status directly, so payments still complete.

## Production

```bash
npm run build      # builds client/dist
npm start          # with NODE_ENV=production: the server serves the site, SEO pages, sitemap and API
```

After you go live on your own domain, add it to **Google Search Console** and submit `https://your-domain/sitemap.xml`.

## Project structure

```
server/
  config/        database and site settings
  controllers/   market (ads, search, chat), orders (checkout, M-Pesa, payouts), customers, admin, support
  market/        categories.js (categories and their details), search.js, seo.js (server-rendered pages and sitemap)
  models/        Listing, Order, Conversation, ChatMessage, Customer, User, SupportThread, SiteSettings
client/src/
  market/        home, browse, ad page, sell, cart, checkout, orders, messages, account
  shop/          site frame (header, footer, bottom bar), login and sign-up, help, support chat
  pages/         admin area
```

The earlier POS and grocery-shop version is kept in git under the tag `pos-snapshot-2026-11-11`.
