# Leo E-commerce — Storefront

The **shopper-facing website** of Leo E-commerce. Each store on the platform
gets its own online shop from this app: shoppers browse the store's
products, sign up, fill a cart, check out with cash on delivery, follow their
order live, and leave reviews.

It is one half of a pair. The store's owner and staff run everything behind
the shop — products, prices, stock, warehouses, orders, coupons, the shop's
look — in the **dashboard**,
[`AdminPortalSingleOrgNextJs`](https://github.com/leotechbd/AdminPortalSingleOrgNextJs).
Both apps read and write the **same database**.

```
     Shoppers                          Store owner and staff
        │                                       │
        ▼                                       ▼
┌──────────────────────────┐        ┌──────────────────────────┐
│  Storefront (this repo)  │        │  Dashboard               │
│  one deployment per store│        │  every store, one app    │
│  STORE_ORGANIZATION_ID   │        │  /dashboard  /provider   │
└────────────┬─────────────┘        └────────────┬─────────────┘
             │      reads: products, stock,      │
             │      prices, theme, promotions    │
             │      writes: customers, carts,    │
             │      orders, reviews              │
             ▼                                   ▼
        ┌─────────────────────────────────────────────┐
        │   MySQL / MariaDB — one shared database,    │
        │   every row tagged with its store           │
        └─────────────────────────────────────────────┘
```

**Contents** — [What it is for](#what-it-is-for) ·
[What shoppers can do](#what-shoppers-can-do) ·
[How it relates to the dashboard](#how-it-relates-to-the-dashboard) ·
[Getting started](#getting-started) · [Architecture](#architecture) ·
[Folder structure](#folder-structure) · [Adding a feature](#adding-a-feature) ·
[Security](#security) · [Tests and CI](#tests-and-ci) ·
[Deployment](#deployment)

---

## What it is for

A store that sells online needs a website its customers can buy from, that
always shows the store's real products, prices and stock, and whose orders
land straight in the store's back office. This app is that website.

- **One store per deployment.** The deployment's `STORE_ORGANIZATION_ID`
  decides which store it is. Every read and write is scoped to that store, so
  a shopper only ever sees that store's products and only ever has an account
  there. Running ten shops means ten deployments of this app (each with its
  own domain), all managed from the one dashboard.
- **Any kind of catalog.** One product or thousands; simple items or products
  with variants (size, colour, weight…), each with its own price, photos and
  stock; items sold by weight or volume (ordered by amount, in pack steps).
- **What the store decides, the website shows.** Products appear only once the
  store has offered them online and stocked the warehouse that sells online;
  prices, discounts, the theme, banners, pop-ups and coupons all come from the
  dashboard.
- **Bangladesh first.** Bangla (default) and English, prices in Taka (৳),
  Dhaka time, cash on delivery.

---

## What shoppers can do

| Area | What it does |
| --- | --- |
| **Browse** | Home page with banners and featured products; shop by department and category, with filters (price, size, colour, brand, any attribute) and sorting; search; recently viewed |
| **Product page** | Photos per variant, options (size/colour…), stock shown from the online warehouse, ratings and reviews, related products, size guide |
| **Compare & wishlist** | Compare products side by side; save to a wishlist — kept in the browser for guests and in the account once signed in |
| **Cart** | Works signed out (in the browser) and signed in (on the server); merged on sign-in; checked against live stock and price |
| **Checkout** | Saved addresses, delivery charge by area, coupons, a clear total; **cash on delivery**; a double-click or retry never creates two orders |
| **Account** | Sign up, sign in, forgot / reset password; profile and addresses; order history and details; cancel an order before it ships |
| **Live updates** | The order page updates as the store confirms, packs, ships and delivers; a notification bell for order news |
| **Reviews** | Rate and review delivered purchases (marked "verified purchase"); mark reviews helpful |
| **Information pages** | FAQ, shipping, terms, privacy, size guide, contact, accessibility, journal |
| **Search engines** | Server-rendered pages, sitemap, robots, product and breadcrumb structured data |

Online payment gateways (cards, mobile banking) are not connected yet;
checkout is cash on delivery.

---

## How it relates to the dashboard

| The storefront… | …while the dashboard… |
| --- | --- |
| shows products, prices, stock and the theme | is where the store creates and edits them |
| takes orders and reserves the stock | confirms, picks, packs, dispatches and delivers them, collects cash, handles refunds |
| registers customers and their addresses | lists the store's customers |
| shows promotions and accepts coupons | creates promotions and coupons |
| collects reviews | moderates and replies to reviews |
| shows order status live to the shopper | writes each status change, which the shopper's page receives within seconds |

---

## Getting started

Requirements: Node.js 22+, and MySQL 8 or MariaDB 10.11+ with the dashboard's
database (the storefront has no schema of its own to migrate in production —
it uses the dashboard's).

```bash
npm install
cp .env.example .env            # then fill in DB_*, STORE_ORGANIZATION_ID, …
npm run dev                     # http://localhost:3100  (the dashboard uses 3000)
```

`STORE_ORGANIZATION_ID` is the store's organization id, shown in the
dashboard. To look at a second store's website side by side:

```bash
npm run dev:org -- <organization-id> 3101
```

| Command | What it does |
| --- | --- |
| `npm run dev` · `npm run build` · `npm start` | Develop · production build · run it |
| `npm run test:db:setup` | Prepare the throwaway `*_test` database |
| `npm test` | Unit and database-backed suites |
| `npm run test:http` | Builds the app, starts it, and runs the HTTP suites — including a real-browser shopper journey (register → add to cart → checkout → see the order) |
| `npm run test:tenancy` | Proves one store can never read another's data |
| `npm run lint` · `npm run typecheck` | Static checks |
| `npm run validate:production` | Checks a production environment's settings before launch |

---

## Architecture

Next.js (App Router, React Server Components) on Node, MySQL through
`mysql2`, Redux Toolkit Query in the browser, Zod for validation, Tailwind
CSS.

### How a page is built

```
app/(routes)/product/[idOrSlug]/page.jsx     thin route: metadata + render the view
        │
        ▼
views/ProductDetailPage.jsx                  Server Component: reads data, renders HTML
        │
        ▼
lib/serverDataCache.js                       cached public reads (invalidated when data changes)
        │
        ▼
services/products/…  →  models/productModel.js  →  MySQL (scoped to STORE_ORGANIZATION_ID)
```

Pages are rendered on the server, so shoppers and search engines get real
HTML. Interactive parts (cart buttons, variant pickers, forms) are client
components inside the view.

### How an API call is handled

```
Browser  POST /api/orders   (RTK Query from store/shopApi.js)
        │
        ▼
app/api/orders/route.js                      withRoute(): DB ready · CSRF · errors → JSON
        │
        ├── lib/auth.js        requireUser() — session cookie → shopper
        ├── schemas/*.js       Zod: the body's exact shape, or 400
        ▼
services/orders/checkout.js                  business rules, in one transaction
        │                                    (price, stock reservation, coupon, idempotency)
        ▼
models/orderModel.js  →  MySQL               + a live event for the order page
```

### Layers

| Layer | Folder | Does | Never |
| --- | --- | --- | --- |
| Route | `app/(routes)/**/page.jsx` | Metadata and which view to render | Business logic |
| API route | `app/api/**/route.js` | Wrapped in `withRoute()`; authenticate, validate, call a service | Write SQL |
| View | `views/` | The page, as a Server Component | — |
| Component | `components/` | Reusable UI, client or server | Fetch data on its own |
| Service | `services/` | Business rules: pricing, checkout, cart, reviews | Read the request |
| Model | `models/` | The only place with SQL; every query scoped to the store | Decide rules |
| Schema | `schemas/` | Zod shapes, shared by server and forms | — |
| Client state | `store/` | RTK Query endpoints, guest cart and wishlist | — |
| Library | `lib/` | Sessions, CSRF, rate limits, caching, i18n, currency, events, SEO | — |

---

## Folder structure

```
app/
├── (routes)/                pages: home, shop, product, cart, checkout,
│   ├── (account)/           dashboard, orders, profile, reviews (signed in)
│   └── …                    login, register, wishlist, compare, info pages
├── api/                     JSON endpoints used by the browser
├── files/[id]/              this store's images (products, banners, theme)
├── sitemap.js · robots.js   search engines
└── layout.js                fonts, theme, locale
views/                       one Server Component per page
components/                  UI: product cards, filters, header, cart, checkout…
services/                    business rules (orders/ and products/ split by concern)
models/                      SQL, scoped to the store
schemas/                     Zod validation
store/                       Redux Toolkit / RTK Query (browser)
lib/                         platform code: auth, session, csrf, rateLimit, cache, i18n, events…
context/                     theme and locale providers
config/db.js                 the connection pool
proxy.js                     per-request security headers (CSP nonce)
sql/schema.sql               the schema the tests build from
scripts/                     test servers, setup and maintenance scripts
tests/                       unit, database and HTTP/browser suites
docs/                        notes on pricing, images, deployment
```

---

## Adding a feature

1. **Data** — schema changes belong to the dashboard's migrations (the
   database is shared); then mirror them in `sql/schema.sql` for the tests.
2. **Model** — add the query to `models/`, always filtered by the store
   (`getOrganizationId()` from `lib/tenant.js`).
3. **Service** — put the rule in `services/`.
4. **Input** — describe the request with Zod in `schemas/`.
5. **API** — a `route.js` under `app/api/`, wrapped in `withRoute()`;
   `requireUser()` if it is the shopper's own data.
6. **Page** — a view in `views/` and a thin `page.jsx` under `app/(routes)/`;
   or a client call through `store/shopApi.js`.
7. **Text** — both languages in `lib/i18n/dictionaries/` (`bn.js`, `en.js`).
8. **Tests** — a suite in `tests/` (and `tests/http/` for the HTTP layer).

**Rules:** every query is scoped to the store; every state-changing API route
goes through `withRoute()` (CSRF and origin checks); shopper data comes from
the session, never from an id in the request; nothing that is not the
shopper's own goes to the browser.

---

## Security

| Concern | How it is handled |
| --- | --- |
| **Store isolation** | Every query is scoped to `STORE_ORGANIZATION_ID`; `npm run test:tenancy` proves it, and a separate scope check runs over the code |
| **Sessions** | Server-side sessions in an HttpOnly, Secure cookie; idle and absolute expiry; all sessions revoked on a password change |
| **CSRF** | Origin check plus a session-bound token on every state-changing request |
| **Brute force** | Rate limits on sign-in (per address and per account), sign-up, password reset and coupon checks; account lockout |
| **Input** | Every request body and query validated by Zod; unknown fields rejected |
| **Orders** | Prices and stock decided on the server; checkout is idempotent (a retry never creates a second order); a cap on open cash-on-delivery orders per shopper |
| **Pages** | Nonce-based Content Security Policy, HSTS, no MIME sniffing, no framing |
| **Privacy** | Password hashes and tokens never reach the browser (tested on every signed-in page) |
| **Images** | Served from the database: only this store's shop media (products, banners, theme, logo) — never staff uploads, and another store's image gets the same 404 as a missing one |

---

## Tests and CI

| Suite | Command | Covers |
| --- | --- | --- |
| Unit and database | `npm test` | Services, models, pricing, validation, sessions, caching, i18n — about 1,240 tests |
| HTTP and browser | `npm run test:http` | Every API route over real HTTP, security headers, server-rendered pages, and a real-browser shopper journey |
| Multi-instance | `npm run test:multi-instance` | Live order updates across separate server processes |
| Cold start | `npm run test:http:cold-start` | A fresh server's first page load |
| Tenancy | `npm run test:tenancy` | One store cannot read another's data |

Every pull request runs, in GitHub Actions against a throwaway MariaDB: a
production-dependency audit, lint, type check, all of the above, a check that
no critical suite was skipped, and a production build.

---

## Deployment

One deployment per store, on Vercel (or any Node host):

1. Provision the store in the dashboard's provider console and copy its
   organization id.
2. Deploy this app with `STORE_ORGANIZATION_ID` set to it, the shared
   database's credentials (a least-privilege `storefront_app` user), the
   store's domain, and mail settings for password reset.
3. `vercel.json` schedules a nightly clean-up of expired sessions, rate-limit
   counters and events (`/api/admin/cron/cleanup`, protected by `CRON_SECRET`).

The full checklist, for both apps, is the dashboard's
**[docs/production/LAUNCH.md](https://github.com/leotechbd/AdminPortalSingleOrgNextJs/blob/main/docs/production/LAUNCH.md)**.
Every environment variable is listed in `.env.example`.

---

## Related

- **Dashboard**: [`AdminPortalSingleOrgNextJs`](https://github.com/leotechbd/AdminPortalSingleOrgNextJs)
- [docs/pricing.md](docs/pricing.md) — how prices, discounts and batches decide what a shopper pays
- [docs/IMAGE_FRAMING.md](docs/IMAGE_FRAMING.md) — how product photos are framed
