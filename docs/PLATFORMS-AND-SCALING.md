# Platforms, architecture and scaling

Kapu is **one React front end** (`client/`) and **one Node.js / Express API** (`server/`) with MongoDB. This document covers:

- how that same code runs on every platform;
- how the code is organised;
- how to run several servers;
- which security and performance measures apply.

## 1. One front end, four platforms

| Platform | How it runs | Login |
|---|---|---|
| Desktop web | The Express server serves `client/dist` | httpOnly session cookie |
| Mobile web | Same, with mobile-first layouts (bottom bar, sheets, sideways-scrolling rows) | httpOnly session cookie |
| Installable PWA | `client/public/manifest.webmanifest` + `sw.js` (offline page, install prompt, update check) | httpOnly session cookie |
| Android app | Capacitor wraps the same build (`client/android`) | Bearer token kept in the app's private storage |

Everything platform-specific lives in **`client/src/platform.js`**. Pages and components never check the platform themselves. That module covers:

- `isNative` / `platform`;
- the app's token storage (Capacitor Preferences);
- the Android back button: it closes open sheets first, then goes back, then exits on the home page.

The Android app differs from the website in a few ways:

- **Login:** the app is served from `https://localhost` inside the phone, so the API is another site and WebViews may drop its cookies. The app keeps the login token itself and sends `Authorization: Bearer …`.
  - The server accepts that and skips the CSRF check, since a Bearer request can't be forged by another site.
  - Browsers keep using the httpOnly cookie, which is safer on the web.
- **No service worker:** the files ship inside the app.
- **No Google sign-in button:** Google blocks its sign-in inside app WebViews. Email or phone and password work. A native Google plugin can be added later.
- **Permissions** (asked at the moment they're used):
  - location, for delivery pins, "near me" and riders' live location;
  - camera, for ad photos.

### Building the Android app

You need Android Studio (it includes the Android SDK and Java).

```bash
cd client
cp .env.android.example .env.android      # set VITE_API_URL=https://your-domain/api
npm run build:android                     # builds the React app for Android and copies it into android/
npm run android:open                      # opens Android Studio: Run ▶, or Build → Generate Signed Bundle (Play Store)
```

- **API address:** the app calls the API at `VITE_API_URL`. The server must allow the app's origin; `APP_ORIGINS` defaults to `https://localhost,capacitor://localhost` (set `APP_ORIGINS=off` to remove it).
- **App details:**
  - App id: `ke.ordersasa.app` (in `client/capacitor.config.json`).
  - Icons and splash come from `client/assets/` (`npx capacitor-assets generate --android`).

## 2. Architecture

```
client/                 React 19 + Vite: one front end for web, PWA and Android
  src/platform.js       the only platform-specific code
  src/shop/shopApi.js   the API client (cookie on the web, Bearer token in the app)
  src/market/*          marketplace pages and reusable components (cards, maps, search, tracking)
  src/shop/*            the frame: header, menus, account switcher, context (session, cart, live updates)
  android/              the Capacitor Android project
server/
  routes/               URLs → middleware (auth, roles, validation, rate limits) → controller
  controllers/          request handling: read input, call business logic, shape the response
  market/               business logic with no HTTP in it (pricing, matching, ETA, search, discounts…)
  models/               MongoDB schemas and their indexes
  security/             headers, CORS/CSRF, sessions, roles (RBAC), validation, sanitising, audit log, rate-limit store
  utils/                infrastructure: cache, Redis, jobs/queue, real-time, presence, email
```

## 3. Running several servers (horizontal scaling)

The API keeps no state that only one server knows about:

| Concern | One server | Several servers (`REDIS_URL` set) |
|---|---|---|
| Sessions | Database-backed tokens | Same |
| Cache (`utils/cache.js`) | Memory | Memory, plus shared values in Redis; clearing reaches every server (pub/sub) |
| Rate limits | Memory | Redis (`security/rateStore.js`); if Redis is down, requests are let through |
| Live updates (Socket.IO) | In process | Redis adapter: an event reaches people connected to any server |
| Who's online | Memory | Redis keys refreshed every 30 s |
| Scheduled tasks | Timer | MongoDB lock: each run happens on exactly one server |
| Slow work (emails…) | MongoDB queue, retried with back-off | Same (any server picks jobs up) |

- **Uploads:** photos are stored in `server/uploads`. With several servers, mount a shared volume there (or move to object storage).
- **Load balancer:** use sticky sessions *or* WebSocket-only Socket.IO transport, and send `SIGTERM` on deploys. The server then stops taking connections and finishes running requests and the current job before exiting.

```bash
# server/.env
REDIS_URL=redis://localhost:6379        # or rediss://user:pass@host:port
```

## 4. Security (server side)

- **Authentication:**
  - httpOnly, Secure, SameSite session cookies (web) or Bearer tokens (app);
  - sessions are stored server-side, so they can be ended;
  - bcrypt passwords;
  - staff accounts with weak default passwords must change them.
- **Authorisation:** role-based access control on the server (`security/rbac.js`): admin, moderator areas, buyer, seller, rider, agent and partner checks in every handler.
- **Input:** schema validation per route (`security/validate.js`); every request is sanitised against NoSQL operators, prototype pollution and HTML (`security/sanitize.js`).
- **Browser attacks:**
  - CSP with nonces, HSTS, frame, sniffing and referrer protection (`security/headers.js`);
  - CORS limited to our sites and the app;
  - signed double-submit CSRF tokens for cookie logins.
- **Rate limits** on logins, sign-ups, posting, chat, AI search, payments and support.
- **Uploads:** image types only, with the real file signature checked (magic bytes); size and count limits; random names; served with a sandboxing CSP.
- **Sensitive data:**
  - phone numbers and exact locations are shown only to the people in the deal;
  - tokens and keys are removed from logs;
  - queued emails are wiped once sent.
- **Audit log** of staff changes and refused requests (`security/audit.js`).

## 5. Performance

- **Indexes:**
  - compound indexes for every hot query: search and category pages with their default sort, orders by buyer, seller and status, unread counts, open rider jobs near a point, live rider positions, chats;
  - geo indexes for "near me" and rider matching;
  - TTL indexes for notifications and finished jobs.
- **Pagination:**
  - search pages (48 a page);
  - admin lists;
  - chat history (the newest 100 messages, "Load earlier messages" for older);
  - hard caps on other lists.
- **No N+1 queries on hot paths:**
  - rider matching loads workloads in one aggregate;
  - checkout loads all agreed prices in one query;
  - live location updates write with one bulk operation and targeted `$set`s.
- **Smaller responses:**
  - list endpoints return card fields only;
  - live rider updates go to open screens only, without notifications or table rebuilds;
  - gzip on every response.

## 6. Authentication

There is one customer account system (`server/models/Customer.js`, `controllers/customerController.js`, `routes/customerRoutes.js`, `middleware/customerAuth.js`, `security/session.js`). Staff are separate (`models/User.js`, behind the private staff link).

| Step | What happens |
|---|---|
| **Sign up** | Full name, email, phone, password and **password confirmation**, validated on the server (`security/validate.js`) |
| | Email is normalised (Unicode NFKC, trimmed, lowercase) and checked for a sensible shape |
| | Password: 10+ characters with uppercase, lowercase and a number; not a common password; not the person's name or email. Hashed with bcrypt (cost 11) |
| | Saved with `emailVerified: false`; a verification link (random 32-byte token, only its SHA-256 hash is stored, expires after 24 h) goes out through the email queue using your SMTP settings |
| | **Nobody is logged in.** An email that already has an account gets the same answer (no account enumeration) and the owner gets an email instead |
| | A role is never taken from sign-up: unknown fields are dropped, `accountType` can only be buyer or seller |
| **Confirm email** | `/verify-email?token=…`: single use; the token is removed from the address bar; doesn't log in |
| **Log in** | Email or phone + password; bcrypt comparison; a generic error for wrong password or unknown account (same timing); **unverified accounts are refused** after the password check |
| | Rate limit per IP, plus account lockout after 5 wrong passwords (15 min) |
| | Success creates a server-side session (revocable); the browser gets an httpOnly, `SameSite=Lax`, `Secure` + `__Host-` cookie over HTTPS; the Android app gets a Bearer token |
| | Sessions expire (14 days idle, 30 days at most); every request is checked against the session record on the server; logout, password change/reset and "sign out everywhere" revoke at once (on every server, with Redis) |
| **Password reset** | Generic answer; single-use hashed token, 30 min; same password rules and confirmation; signs out every device; proves the email (marks it verified) |
| **Google** | Google Identity Services button; the ID token (OpenID Connect) is verified on the server: RS256 signature against Google's current keys, audience = our client id, issuer, expiry, `email_verified` |
| | Linking Google to an account that never confirmed its email removes that account's password (someone else may have set it) |
| **Roles** | Server-side middleware on every protected route: customer login (`protectCustomer`), field-team roles (approved rider / agent / partner), staff (`protect`) with admin / moderator areas (`can(…)`, `security/rbac.js`) |

Accounts created before email verification existed were marked verified once, so nobody already using the site was locked out.

## 7. Push notifications (Android)

1. Create a Firebase project and add an Android app with id `ke.ordersasa.app`. Put the downloaded `google-services.json` in `client/android/app/`.
2. In `client/.env.android`, set `VITE_PUSH=on`.
3. Firebase → Project settings → Service accounts → *Generate new private key*. Keep the JSON **on the server only** and set `FIREBASE_SERVICE_ACCOUNT_FILE=/secure/path/file.json` in `server/.env`.

Every in-app notification (order updates, chats, rider on the way…) is then also pushed to the person's phones. It's sent through the job queue with retries, and phones that uninstalled the app are forgotten. Tapping a notification opens its page.

Push to installed PWAs and desktop browsers (Web Push) is **not** implemented. Open tabs still get live notifications.

## 8. Weak or lost connections

- Reads (GET) are retried automatically: twice, after 0.8 s and 2.4 s, on a dropped connection, a timeout or a 502/503/504.
- Changes (orders, payments, posts) are **never** retried automatically, so nothing happens twice.
- An "offline" banner shows while there's no connection. On reconnect it says "Back online", live updates reconnect and orders, chats and counts reload.
- Errors say "No internet connection…" instead of technical text.

## 9. Android build safeguards

- `npm run build:android` refuses to build unless `VITE_API_URL` is an `https://…/api` address.
- The app blocks plain-http traffic (`usesCleartextTraffic="false"`).
- After building, `scripts/check-app-secrets.mjs` scans the bundle and fails the build if it finds:
  - any value from `server/.env`'s secrets;
  - a private key;
  - a database or Redis address with a password;
  - an AI key or a service account;
  - a front-end variable that looks like a secret.

  Run it any time with `npm run check:secrets`.

## 10. Tests

| Command (in `server/`) | What it covers |
|---|---|
| `npm run test:unit` | Pure functions: email normalisation, password rules, request validation, Google ID-token checks, rider ETA/capacity, delivery stages, search, discounts |
| `npm run test:security` | Headers, CORS, CSRF, injection, XSS, sessions, cookies, HTTPS redirect, brute force, IDOR, RBAC, uploads, error leaks, M-Pesa callbacks, audit |
| `npm run test:auth` | Every sign-up / verification / login / session / reset / Google path, failure cases, and what each role may reach |
| `npm run test:push` | Device registration rules, Firebase message format and sign-in, uninstalled phones, retries |
| `npm test` | All of the above |

Each starts the real server on a throw-away database.

## 11. Who gets paid, and the payment ID

| Checkout paid by M-Pesa | Where the money goes |
|---|---|
| **One seller** | Straight to that seller's own Till, Paybill or Pochi la Biashara (`server/market/splitPay.js`), plus our verification & inspection fee |
| **Several sellers** | One M-Pesa payment to the **Kapu wallet** for the goods **and the delivery fees** (nothing is paid on delivery; riders don't collect cash). Kapu pays each seller after delivery |

**Payment ID:** once a payment is complete, it gets our payment ID (`PAY-` + 8 characters):
- A wallet payment shares one ID across its orders; a direct payment has its own.
- It shows on the buyer's orders, the order page, the receipts and the "payment received" email.
- Our team gets an email for every paid order (to `site().ordersEmail` or the site email) with the payment ID, the buyer, each seller and the items.
- Admin → Orders finds orders by payment ID or M-Pesa code (and links from the email open the search).

**Paying one seller directly applies when:** the seller has M-Pesa details **and a shop on the map** (our agent goes there), and the checkout isn't a Safe deal, courier or rider-inspected delivery. Otherwise it is paid to the Kapu wallet.

**Order of payments:**

1. **Our verification & inspection fee** comes first, in one M-Pesa prompt to Kapu's own shortcode.
   - It is `fieldwork.directFee`: KSh 150 by default, changeable by admins. Any inspection the buyer asked for is added.
   - It becomes each order's **inspection fee**. When the seller confirms, an inspection job opens for our agents. The agent earns that fee minus our 15% (KSh 127 of KSh 150), checks that the payment reached the seller, and checks that the goods match. The seller can't ship until the agent passes it.
2. **Then the seller** (the machinery handles several sellers one prompt at a time, though checkouts with several sellers now go to the wallet):

| Seller has | What the buyer does |
|---|---|
| Till or Paybill **with M-Pesa prompts connected** (My account → their own Daraja keys) | Gets an M-Pesa prompt that pays that Till or Paybill directly. The next prompt goes out as soon as this one is answered, fails, or times out (2 min). |
| Pochi la Biashara, Send Money, or not connected | Taps **Pay from your phone**: the number is copied and, on a phone, the M-Pesa menu (*334#) opens. After paying, the buyer **sends us the M-Pesa code**. Separately, the seller types **the code they received** (Sales → 💵 Confirm M-Pesa). |

**Code matching:**
- We compare the buyer's code with the seller's. If they're the same, the order starts.
- If they differ, both are asked to check, and it's audit-logged for our team.
- Neither side ever sees the other's code, so it can't be copied.
- The seller has 48 hours to enter their code.

An order starts only when **both** that seller's payment and our fee are paid. Switching to cash on delivery before the fee is paid drops the fee.

**Safety checks:**
- Amounts come only from the server.
- A callback for less than the amount is refused.
- An M-Pesa code (seller payment, buyer code, seller code or fee) can be used once only.
- Callbacks need the secret callback key.
- Only the order's seller can enter a code.
- Connecting keys needs the account password and Safaricom's acceptance. Keys are stored AES-256-GCM encrypted (`utils/secretBox.js`, `PAY_SECRETS_KEY`) and never returned.

**Money flow:** no commission is taken on the goods (that money never passes through Kapu) and no seller payout is created. Refunds for a cancelled direct-paid order are due from the seller.

**Receipt:** `GET /api/orders/checkout/:checkoutId/receipt.pdf` lists every seller, their items, the amount, destination and M-Pesa code of each payment, our fee and its code, and the totals.

**Tests:** `npm run test:splitpay` (17 end-to-end tests, Safaricom stand-in: who gets paid, payment IDs, the team email, codes, receipts).

## 12. Seller sign-up and seller contacts

**Sign-up as a seller** (email or Google) requires three things, checked on the server (`sellerProfileFrom` in `controllers/customerController.js`):

1. **What kind of seller:** retailer or shop, wholesaler, importer, mama mboga, samaki dealer, market stall, cereals and groceries, boutique, electronics, motor and spares, baby shop, chemist (up to 5).
2. **What they sell:** market categories (up to 6). Unknown ones are dropped.
3. **Where:** county and town or area. An optional pin from the phone location (inside Kenya only) puts the shop on the near-me pages straight away.

Sellers change kind and categories later in My account (What kind of seller you are). Sellers who declare themselves wholesalers appear on Wholesalers near me even before their ads have bulk prices.

**Contacts:** every near-me card (sellers, wholesalers, importers, mama mbogas, boutiques and the rest) and every seller page has a Show contacts button.
- It calls `GET /api/market/sellers/:id/contact`: logged-in people only, rate-limited (60 an hour, like the ad phone button).
- It returns the number with Call (`tel:`) and WhatsApp (`wa.me`) links.
- Numbers are never in the lists themselves, so they cannot be scraped.
- Sellers whose ads are all set to contact by chat only are not shown; buyers are pointed to chat instead.

**Tests:** `npm run test:sellers` (8 end-to-end tests).

## 13. Shop & ride with us (inspection and delivery via our pickup points)

One button, **🛍️ Shop & ride with us** (header, top bar and mobile menu), replaces "Shop with our agents" and "Deliver with us". It opens `/shop-and-ride`, which links on to "Shop for me" and "Send a parcel".

**Prices** (`server/market/shopRide.js`; admins can override any of them in `fieldwork.shopRide`):

| | Price |
|---|---|
| Inspection (optional) | KSh 200, on top of delivery |
| Delivery up to 5 kg, bought in the CBD | KSh 150 to the pickup point in any part of Nairobi |
| Delivery up to 5 kg, bought outside the CBD | KSh 250 (it comes to the CBD hub first) |
| Over 5 kg | base + KSh 20 per extra kg, × traffic (rush hour 1.3, night 1.15) × urgency (express 1.5), rounded to KSh 10 |
| Repackaging | free by default (`repackFee`) |
| Door delivery | from the pickup point nearest the buyer to their live location, Bolt Send style: KSh 100 + KSh 30/km + KSh 4/min (time from distance and traffic), minimum KSh 150 |

The per-kg rate, the traffic and urgency factors and the door rates are starting values, not Bolt's own numbers (Bolt doesn't publish a rate card). Adjust them to your costs.

**Pickup points** (`models/PickupPoint.js`, `market/pickupPoints.js`):
- The CBD hub plus a point in each area. A fresh database gets 13 starter points at **approximate** locations.
- Replace them with your real addresses in **Admin → Orders → 🛍️ Shop & ride** (add points, switch starters off).
- The list is cached for a minute per server.

**One booking, one or more sellers** (up to 5): each seller is its own errand of kind `shopride`, and they share a `group`. Each seller has their own agent job, inspection and tracking, and all of them go to the same pickup point or door.

**When the buyer pays:**

| When | What | To whom |
|---|---|---|
| When booking (one M-Pesa prompt) | Every seller's inspection (+ repacking) | Kapu |
| When our agent passes a seller's item | That seller's goods (the price the buyer entered), plus that seller's delivery fee for a **pickup-point** booking (a separate prompt per seller, as each passes) | Kapu, which then pays the seller |
| When it reaches the door | **Door** bookings: every delivery fee plus the door fare (once) | Our rider at the door |

- **Failed inspection:** that seller's part is cancelled and the goods aren't bought or charged. The agent is still paid for the inspection.
- **The agent waits for payment:** they can't mark the item collected until the buyer's goods payment is in, and they get a "Paid: take the item" alert.
- **Paying sellers:** a seller whose goods are paid shows as "seller to pay" in Admin → Orders → 🛍️ Shop & ride (filter "Sellers to pay"). The team pays them and records the M-Pesa code. Automatic B2C payment to sellers isn't wired up yet.
- **No inspection ticked:** nothing is paid when booking. The agent still checks the item before the goods payment.

**The journey:**
1. Our agent's job (a delivery task with a check): collect from the seller, inspect, repackage if asked, and bring it to the CBD hub once the goods are paid. The agent earns the fee minus our 15%.
2. At the hub, our team (Admin → Orders → 🛍️ Shop & ride) marks the next step:
   - **At the pickup point:** the buyer gets an in-app message, push and email with the point's name, address and hours, and the booking number to show. Then **Collected**.
   - **Out for delivery** (door bookings): then **Delivered**.
3. The buyer can confirm with "Yes, I received it".

The price of the goods goes through Kapu to the seller only after the item passes inspection. Leaving out the price means the buyer pays the seller themselves.

**Filling in the booking:**
- **What did you buy?** Suggestions appear as the buyer types (`GET /api/errands/shopride/items`): kinds of items whose words start with what is typed, and matching ads on Kapu. Picking an ad fills in its seller. While typing on a phone, the field moves up just below the header so the list stays visible above the keyboard.
- **Erasing autofill:** erasing or changing the seller's phone, or tapping "✕ Not this seller", clears what the lookup filled in; anything the buyer typed themselves stays. The form is kept only while the buyer logs in to book; any other visit starts fresh.
- **Seller's phone:** when it matches a seller on Kapu (`GET /api/errands/shopride/seller`), their shop name, address, stall number, area and exact location fill in.
  - Looking up a number needs a login and is rate-limited (30 per 10 minutes).
  - Only what the seller's shop page shows anyway is returned; the exact pin only if their shop is public.
  - At booking, the seller's real phone and location from their account are used, not what was typed.
- **Stall / shop number** is its own field and goes on the agent's job.

**Tests:**
- `npm run test:unit`: 8 pricing tests (traffic hours, CBD/Nairobi, every fee, door fares, refusals, nearest point).
- `npm run test:shopride`: the journey (pickup point and door), admin pickup points, suggestions, the seller look-up and its limits, and performance. On a laptop: 100,000 quotes in about 0.1 s; 300 price checks at once with p95 around 0.5 s; 25 bookings at once.

## 14. How the data fits together (stores, products, orders, deliveries)

| Relationship | Where it lives |
|---|---|
| One seller → many stores / branches | `Store.seller` (one main store per seller, names unique per seller). The main store mirrors `Customer.shopLocation`. |
| One store → many listings | `Listing.store` (the main store unless the seller picks a branch). A branch ad is found near the branch pin. |
| One product → many seller listings, at different prices | `Listing.product` → `Product` (unique `key`: category + type + brand + model, or the title words). |
| One customer → many orders | `Order.buyer` (one order per seller per checkout). |
| One order → many order items | `Order.items[]`; each item keeps its `listing`, `store` and `product`. |
| One order → many delivery records (split fulfilment) | `Delivery.order` + `seq`: one record per store the order ships from. Each has its own status and rider job (`Task.delivery`, `Task.leg`). |

**Split orders:**
- The buyer pays for one delivery. Extra riders for the other stores are the seller's cost (`Order.splitDeliveryFee`, taken off their payout).
- The order is *shipped* when every part has gone out, and *delivered* when every part has arrived.
- Sellers send their own parts from the order page (Packed → Sent → Delivered for cash orders). Buyers tap "I got this part".
- For rider orders, "Call a rider" covers part 1; each other part has its own "Call a rider for this part".

**Seller hub (`/seller`):**
- Overview: orders to handle, sales, commission, extra riders, earnings, payouts, best sellers and stock alerts.
- Inventory: stock with − / + / set (never below zero), low and sold-out filters, moving items between stores, and how other sellers price the same product.
- Stores: add, edit, pin, make main, and close. Closing needs no orders in progress, and its items move first; closed stores are kept for history.

**Delivery dashboard (`/work`):** riders see available jobs, accept, confirm pickup, update on the way / arrived / delivered, and see earnings. Each part of a split order shows as "part N".

**Existing data:** at start-up, every seller with a shop location gets a main store, older listings join it, and older listings are matched to catalogue products (idempotent).

**Tests:** `npm run test:stores` (10 tests: every relationship above, duplicates refused, simultaneous posts, stock races, split deliveries, two-rider orders, earnings).
