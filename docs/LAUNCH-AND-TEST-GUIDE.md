# Kapu: launch the app, set up your staff, and run the security checks

A step-by-step guide for running Kapu on your own computer, signing in as the **owner**, adding **admins** and
**moderators**, and checking that every module passes the security tests. All commands are typed in a terminal
(PowerShell on Windows) opened in the project folder `Pos-system`.

---

## 1. Before you start (once)

| You need | How to check | If it's missing |
|---|---|---|
| Node.js 20 or newer | `node --version` | Install the LTS version from nodejs.org |
| MongoDB running on this computer | `Get-Service MongoDB` shows **Running** | Start it: `Start-Service MongoDB`, or open **services.msc** → *MongoDB Server* → Start |
| The server's settings file | `server\.env` exists | Copy `server\.env.example` to `server\.env` and fill it in (never commit it; git blocks it) |
| The packages | `server\node_modules` and `client\node_modules` exist | `npm run install-all` |

> **OneDrive tip:** the project is inside OneDrive. If `npm install` fails with *EPERM*, *Input/output error* or
> *reparse point*, pause OneDrive syncing (OneDrive icon → Pause syncing) and run it again, or move the project to
> a folder outside OneDrive (e.g. `C:\dev\Pos-system`).

---

## 2. Launch the app

```powershell
npm run dev
```

This starts both parts and keeps them running (stop with **Ctrl + C**):

| Part | Address | What it is |
|---|---|---|
| The marketplace (shop) | http://localhost:5173 | What buyers, sellers, riders and agents use |
| The server (API) | http://localhost:5000 | Data, payments, security (opened by the app, not by you) |
| The staff panel | your private staff link (next step) | Owner, admins and moderators |

---

## 3. Become the owner

The staff panel has no public address. Each marketplace has a **private staff link**. Get yours:

```powershell
npm run staff-link
```

It prints something like `http://localhost:5173/staff/nhm_GxS4UXDJZMBJTgSu`. Open it in your browser.

- **First time (no staff accounts yet):** the page says *Create the owner account*. Enter your name, email and a
  strong password (8+ characters with letters and numbers). You are now the **owner**.
- **Already had an admin account from before?** When the server starts, the longest-serving admin automatically
  becomes the owner (once). Sign in with that account.
- **Prefer the terminal?** `$env:ADMIN_EMAIL="you@example.com"; npm run seed` creates the owner with a strong
  temporary password (printed once). You choose your own password at the first sign-in.

> Keep the staff link private. If it leaks, or someone leaves the team: **Team → Change link** (or
> `npm run staff-link -- --new`), and disable their account.

---

## 4. The three staff roles

| | 👑 Owner | 🛡️ Admin | 🧭 Moderator |
|---|---|---|---|
| Panel name & badge | *Owner panel*, gold badge | *Admin*, blue badge | *Moderation*, grey badge |
| Ads, sellers, orders & payouts, support | ✅ | ✅ | Only the areas ticked for them |
| Dashboard money (sales, commission, revenue) | ✅ | ✅ | ❌ counts only |
| Add / change **moderators** | ✅ | ✅ | ❌ |
| Add / change **admins and owners** | ✅ | ❌ | ❌ |
| Site settings (name, contacts, hours, social, banner) | ✅ | ✅ | ❌ |
| **Money settings** (commission, rider & agent fares, courier fees, demo payments) | ✅ | 👁️ read-only | ❌ |
| Security log, staff link | ✅ | ✅ | ❌ |

Rules the server enforces (not just the screen):
- There is **always at least one active owner**: the last owner can't be demoted, disabled or deleted.
- Nobody can change their own role or disable themselves.
- Changing someone's role, password or access signs them out everywhere.

### Add your team
1. Staff panel → **Team** → **+ Add staff member**.
2. Name, email, and a role. For a moderator, tick what they may open (Ads · Sellers · Orders & payouts · Support).
3. Click **Save**, then **Copy all** and send them the login details privately (e.g. WhatsApp). They choose their
   own password at the first sign-in.

---

## 5. Run every security check (one command)

```powershell
npm run check:security
```

It takes about 4 minutes and ends with a table like this:

```
✅ PASS  Settings
✅ PASS  2. Secret scan
✅ PASS  3a. Dependencies (server)
✅ PASS  3b. Dependencies (app)
✅ PASS  4. Security attack tests
✅ PASS  5. Accounts & sign-in
✅ PASS  6. Staff roles (owner / admin / moderator)
✅ PASS  7a. Every module (full server suite)
✅ PASS  7b. The app’s tests
✅ PASS  8a. Build the app
✅ PASS  8b. No secrets in the built app
All security checks passed. ✔
```

For a faster run while you work (skips step 7): `npm run check:security -- --quick`

| Check | What it proves | If it fails |
|---|---|---|
| 1. Settings | `server\.env` has a strong `JWT_SECRET`, a database, and safe cookie settings (values are never printed) | Follow the message; generate secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| 2. Secret scan | No passwords, keys or `.env` files in anything git tracks | Remove the secret from the file **and change that key** (it may already be copied) |
| 3. Dependencies | No package with a known high or critical vulnerability | `npm audit` in that folder shows which; `npm audit fix` or update it |
| 4. Security attack tests | Injection, XSS, CSRF, session theft, file uploads, rate limits, payment tampering are all blocked | Read the failing test's name: it says which protection broke |
| 5. Accounts & sign-in | Sign-up rules, email verification, lockout after wrong passwords, password reset, Google sign-in, customer vs rider roles | Same |
| 6. Staff roles | Every owner / admin / moderator boundary in the table above | Same |
| 7. Every module | The whole marketplace: ads, orders, M-Pesa, Lipa Pole Pole, split pay, Ride with us, maps, field team, documents… | Same |
| 8. App bundle | The app downloaded to phones holds no server secrets | Never put secrets in `VITE_` variables in `client\.env*` |

> MongoDB must be running for steps 4–7 (they use throw-away test databases and delete them afterwards; your real
> data is never touched).

Run single parts when you're fixing something: `cd server` then `npm run test:security`, `npm run test:auth`,
`npm run test:roles`, `npm run test:maps`, `npm test`.

---

## 6. Try every module by hand (15 minutes)

Use **demo payments** so nothing real is charged: as the owner, **Settings → Riders & shopping agents → 🧪 Demo
payments** (only possible while M-Pesa isn't connected).

**As a buyer** (http://localhost:5173, sign up with an email address you can open: with SMTP set in `server\.env`
the verification email really arrives; without SMTP, the server terminal prints a `preview:` link for each email):
- [ ] Search, open an ad, chat with the seller
- [ ] Buy online → choose *Inspect my goods* or *Don't inspect* → pay (demo) → see the order
- [ ] **Ride with us** → send a parcel → choose Bike / 4-seater car / Pickup → book → track
- [ ] **Shop for me** → photograph or type a list → submit
- [ ] Lipa Pole Pole on an ad with a deposit

**As a seller** (another account): post an ad with photos → receive the order → confirm it.

**As a rider:** apply under *Work with us* → as staff, approve them in **Field team** → the rider sees and accepts a job.

**As staff** (one browser window per role, or a private window):
- [ ] Owner: add an admin and a moderator; change the commission
- [ ] Admin: try to change the commission (it's read-only) and to edit the owner (not allowed)
- [ ] Moderator: only their menus show; the dashboard has no money figures
- [ ] Report an ad as a buyer → a moderator with *Ads* hides it
- [ ] **Security log**: every sign-in and change you just made is listed

---

## 7. Before going live

- [ ] `npm run check:security` passes completely
- [ ] `server\.env`: `NODE_ENV=production`, real `SHOP_URL` / `PUBLIC_API_URL` on **https**, `COOKIE_SECURE` not `false`
- [ ] Separate long random values for `JWT_SECRET`, `PAY_SECRETS_KEY` and `MPESA_CALLBACK_SECRET`
- [ ] Live M-Pesa keys (`MPESA_ENV=production`); demo payments switch off by themselves once M-Pesa is connected
- [ ] Email (SMTP) set up, so customers receive verification and reset emails
- [ ] A new staff link (`npm run staff-link -- --new`) if the test link was shared, and only real staff accounts left
- [ ] Database backups scheduled (e.g. `mongodump` nightly, or MongoDB Atlas backups)
- [ ] Android app: set `VITE_API_URL` in `client\.env.android` to the live https API, then `npm run build:android --prefix client`
