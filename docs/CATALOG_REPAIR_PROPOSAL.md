# Catalog Repair Proposal — duplicate products/SKUs, category references

Read-only findings from a live scan of the dev database (`ladies_multi_ecomm`)
and browser verification against the real dev server (not the disposable
test DB), commit `9aed53c` + this audit's fixes, current as of 2026-09-18.

**Status at a glance (updated 2026-09-18, second pass):**
- Pair 1 (Saudi-Style Closed Burqa) — **EXECUTED**, verified in-browser.
  A pre-existing (not caused by this repair) variant-pricing display bug
  was surfaced — see section 2.
- Pair 3 (Relaxed Straight Jeans) — **EXECUTED, then corrected and
  re-verified.** The newer, canonical listing is restored and purchasable;
  the older record is preserved, inactive, with an archived SKU. See
  section 3 for exact before/after values and full verification (category
  page, product access, cart, and inactive-product server-side rejection).
- Pair 2 (Instant Jersey Hijab) — **NOT executed.** Prices/currency
  unchanged, per instruction. Awaiting your decision (section 4).
- The `UNIQUE` constraint on `product_variants.sku` — **NOT installed** on
  this database, and migration `0002` has **not** been run again this
  pass, per instruction (it would still correctly refuse on pair 2 alone).
  See section 5.

---

## 1. What was found (original, unchanged from the first pass)

Three pairs of products share both an identical **name** and an identical
variant **SKU**, all following the same pattern: an older product (created
2026-09-02/09-08) whose `category_id` now points at a deleted category, and
a newer duplicate (all created within the same second, 2026-09-17,
strongly suggesting a single re-seed run) with a currently-valid category.

| Pair | Older product | Newer product |
|---|---|---|
| Burqa | `6a98b4cc1dff0db712d98f47` — 2 order_items, 1 review, dangling category | `6aabced3da7ef41850f6ffaf` — 0 orders, valid category |
| Hijab | `6a98b4cc1dff0db712d98f4a` — 2 order_items, dangling category | `6aabced3435ad98399f6ffb3` — 0 orders, valid category |
| Jeans | `6aa0bd5702281c362b1784f6` — **already inactive**, 0 orders, dangling category | `6aabced35f18d2df60f6ffd0` — was active, 0 orders, valid category |

No other duplicate SKUs, dangling `category_id`/`top_category_id`, or
dangling category `parent_id` references exist anywhere else in the catalog.

## 2. Pair 1 (Burqa) — executed, verified, with a pre-existing pricing bug surfaced

**Executed 2026-09-18**, in one transaction, with before/after values:

| Field | Before | After |
|---|---|---|
| `6a98b4cc1dff0db712d98f47.category_id` | `6a98b4a2cc94a6d364aa79c5` (deleted) | `6aabced37a6b9a6953f6ff76` ("Saudi-style Burqa") |
| `6a98b4cc1dff0db712d98f47.top_category_id` | `6a98b4a2cc94a6d364aa79c0` (deleted) | `6aabced3babc317ef6f6ff72` ("Burqa") |
| `6a98b4cc1dff0db712d98f47.is_active` | `1` | `1` (unchanged) |
| `6aabced3da7ef41850f6ffaf.is_active` | `1` | `0` |

**Browser-verified** at `/product/saudi-style-closed-burqa-d98f47`: renders
active, correct breadcrumb `Home > Shop > Saudi-style Burqa`, one variant
(Navy/Free-Size/Nida, 14 in stock, SKU `BUR-SAU-NVY-FS-NIDA`), 1 review
intact. `order_items`/`reviews` counts for this product unchanged (2, 1) —
confirmed via direct query, not assumed.

**Pre-existing pricing bug surfaced by this repair (not caused by it — this
data existed before this session touched anything; the repair only made the
product newly reachable via category browsing, where it wasn't reliably
findable before):**

The Navy/Nida variant has `product_variants.price = 4000` (with no
variant-level `discount_price`), while the parent product has
`base_price = 65`, `discount_price = 55`. `services/orderService.js`'s
`chargePriceUsd()` and `lib/utils.js`'s `resolveVariantPricing()` (used by
the product-detail page) both resolve this as:

```
effectivePrice   = variant.price ?? product.basePrice     = 4000
effectiveDiscount = variant.discountPrice ?? product.discountPrice = 55
displayPrice (= what checkout actually charges) = effectiveDiscount ?? effectivePrice = 55
```

So **checkout correctly charges $55** (→ ৳6,600 at the store's 120
USD→BDT rate) — confirmed against a real historical order for this exact
variant, whose `order_items.snapshot_price` is `6600`, matching exactly.

But the product-detail page displays this as **"৳6,600 ~~৳480,000~~ 99%
OFF"** (480,000 = 4000 × 120) — because `effectivePrice` (the variant's own
`price` field) is used as the *displayed strikethrough/compare-at price*,
and 4000 is clearly bad data (no real item here costs $4,000). **This is
confirmed live in the browser right now.**

A second, separate inconsistency: `components/product/ProductCard.jsx`
(used in "You may also like" grids and category listings) computes its
displayed price via `lib/utils.js`'s `effectivePrice(product)`, which only
ever looks at `product.basePrice`/`product.discountPrice` — **it never
looks at variant pricing at all.** So the exact same product shows
**"৳6,600 ~~৳7,800~~ 15% OFF"** (7,800 = 65 × 120, the product-level base
price) in every card/grid view, and a completely different **"৳6,600
~~৳480,000~~ 99% OFF"** on its own detail page. The charged price (৳6,600)
is identical and correct in both places; only the displayed "was" price and
discount percentage disagree, because the two components use different
pricing logic and the underlying variant `price` field holds implausible
data. **Not fixed — flagged only, since it is pre-existing data (not
something touched in this repair) and a UI-consistency question, not a
checkout-correctness one.**

## 3. Pair 3 (Jeans) — corrected: newer listing restored, older archived, fully re-verified

**First pass (previous session) executed**, per then-current instructions:
re-pointed the older record's category, deactivated the newer (then-only-
active) record. **Confirmed regression at the time:** zero active "Straight
Jeans" listings, product unpurchasable storefront-wide.

**Second pass (this session), executed per explicit instruction — before/after:**

| Field | Before this pass | After this pass |
|---|---|---|
| `6aa0bd5702281c362b1784f6` (older) `is_active` | `0` | `0` (unchanged — stays archived) |
| `6aa0bd5702281c362b1784f6`'s variant `6aa0bd5702281c362b1784f7.sku` | `JNS-STR-BLU-L` (still canonical, colliding) | `JNS-STR-BLU-L-ARCHIVED-1784f7` |
| `6aabced35f18d2df60f6ffd0` (newer) `is_active` | `0` | `1` (reactivated — this is now the live, canonical listing) |
| `6aabced35f18d2df60f6ffd0`'s variant `6aabced3342e280f47f6ffd1.sku` | `JNS-STR-BLU-L-DUP-f6ffd1` (from the prior pass's rename) | `JNS-STR-BLU-L` (canonical SKU restored) |

The older record's `category_id`/`top_category_id` (re-pointed in the first
pass, to `6aabced3161331aa0af6ffa5`/`6aabced36e4d25c420f6ffa3`) were left
as-is — no reason to revert a correct category assignment on an
intentionally-archived record.

### Verification (this session), each item run against the real dev server/DB, not the disposable test DB

- **Category visibility — VERIFIED, with a correction to my own earlier
  testing method.** `/shop?category=6aabced3161331aa0af6ffa5` (using the
  leaf category id directly) still shows "0 products" — **but this is not
  a bug**: `services/productService.js`'s `buildFilter()` aliases the
  `?category=` URL param to the **department-level** `top_category_id`
  column (`?style=` is the alias for the leaf `category_id`), by design,
  for every storefront listing URL. I had been testing with the wrong
  parameter. Using the correct URL —
  `/shop?category=6aabced36e4d25c420f6ffa3&style=6aabced3161331aa0af6ffa5`
  (Jeans department + Straight Jeans style) — **correctly shows "1
  product": Relaxed Straight Jeans, ৳3,600, SIZE L.** Verified by direct
  page-text read of the real rendered page, not assumed from the fix alone.
- **Cache propagation — observed, understood, not a defect.** Immediately
  after the DB write, both the product-detail page and the shop listing
  served stale (pre-fix) data for approximately one request each after the
  300-second `unstable_cache` TTL elapsed — consistent with stale-while-
  revalidate semantics (first post-TTL request triggers a background
  refresh and still serves the stale value; the next request gets fresh
  data). A second request to the product-detail page returned the correct,
  fresh SKU. This is expected behavior for a direct DB write that bypasses
  the app's own `invalidateCacheTags()` call (which only fires from within
  API route handlers) — not something wrong with the repair.
- **Product access (direct URL) — VERIFIED.** `/product/relaxed-straight-jeans-f6ffd0`
  renders correctly: ৳3,600, SKU `JNS-STR-BLU-L`, 12 in stock, `Add to
  Cart` present.
- **Cart behavior — VERIFIED live.** Added the item to cart via the actual
  UI; `/cart` correctly shows "Relaxed Straight Jeans, Blue · L, 1, ৳3,600."
- **Whether inactive products can be purchased via direct links or server
  requests — VERIFIED with a live HTTP-level reproduction, not just source
  reading.** Ran three real requests, through the actual Route Handlers,
  against the **disposable test database** (not dev — no dev data was used
  for this check) with a deliberately deactivated product:
  - `POST /api/cart` with an inactive product's id → **404 "Product not
    found"** (rejected in `services/cartService.js`'s `addToCart()`).
  - `POST /api/orders/preview` with an inactive product → **400 "Product
    ... unavailable"** (rejected in `services/orderService.js`'s
    `calcTotals()`).
  - `POST /api/orders` (real checkout) with an inactive product → **400
    "Product ... unavailable"**, no order created.
  - **Nuance, also verified:** the product-detail *page* itself (a GET,
    not a mutation) does **not** filter by `is_active` — an inactive
    product's page still renders with visible content and an "Add to
    Cart" button. Clicking it, or calling the API directly, is where the
    server-side rejection above actually happens. So inactive products are
    "invisible" via category/shop browsing and "unpurchasable" via any
    mutating request, but still directly viewable if someone has the exact
    URL (e.g. an old bookmark or shared link) — confirmed by evidence, not
    assumed.

## 4. Pair 2 (Hijab) — decision table, not executed

| | Older record | Newer record |
|---|---|---|
| Product id | `6a98b4cc1dff0db712d98f4a` | `6aabced3435ad98399f6ffb3` |
| `is_active` | `1` (currently live, shown as "FEATURED") | `1` |
| `category_id` | `6a98b4a2cc94a6d364aa79c9` — **dangling, deleted** | `6aabced314594d6a82f6ff7a` ("Instant Hijab") — valid |
| Product-level price (USD) | `base_price=5000`, no discount | `base_price=18`, no discount |
| Displayed/charged price (BDT, rate 120) | **৳600,000** (confirmed live on the storefront right now) | ৳2,160 |
| Variants | 1: Black/Free-Size/Jersey, SKU `HIJ-INS-BLK-FS`, stock 50, no price override | 3: Black (`HIJ-INS-BLK-FS`, stock 50), Dusty Rose (`HIJ-INS-ROS-FS`, stock 40), Olive (`HIJ-INS-OLV-FS`, stock 30) — none have a price override |
| Historical order references | **2 orders** (`6a99987240c4c256b7e23aa1`, `6a999eafe1a05ad2816972c8`), both with `snapshot_price = 2160` — i.e. both historical charges match the **newer** record's $18 price exactly, not the older record's $5000 | 0 orders |

**I am not resolving this — I need your answer on:**
1. **What is the actual intended price/currency for this product?** The
   historical order evidence (both real past charges were ৳2,160, matching
   $18 × 120) suggests `base_price=5000` on the older record is bad data
   (a data-entry or unit error), not the newer record's `18` — but this
   audit does not treat "the orders happen to match" as proof of intent,
   only as evidence for you to weigh.
2. **Which variants should remain available** — the newer record's 3
   colors, or should Black be reconciled onto the older (historied) record
   only?

I will not overwrite either record's price, deactivate either one, or
touch the SKU until you answer.

## 5. Migration status — the UNIQUE constraint is NOT installed

Checked directly via `information_schema.statistics`: `product_variants.sku`
still has only the original **non-unique** `idx_product_variants_sku` key.
`schema_migrations` contains only `0001_review_helpful_votes` — migration
`0002_product_variants_sku_unique` is **not** in the ledger. Re-running it
now correctly reports exactly one remaining conflict (`HIJ-INS-BLK-FS`,
pair 2) and refuses to alter anything, exactly as designed — **a refused
migration is not partial success; no enforcement exists on this database
yet.** The constraint will only be installed once pair 2 is resolved and
the migration is re-run and actually completes.

## 6. Correction to this proposal's earlier claim (now removed)

An earlier version of this document said "deactivating the newer product
frees its SKU, satisfying `uq_product_variants_sku` without renaming
anything." **This was wrong and has been removed.** A MySQL `UNIQUE`
constraint applies to the raw column value across every row in the table
regardless of any other column's value (including `is_active` on a
different, joined table) — deactivating a product does nothing to the
literal `sku` string still sitting in `product_variants`. For pairs 1 and 3,
this was corrected by renaming the two now-inactive duplicate variants' SKUs
(see the executed changes below). This correction does not apply
retroactively to change the recommended approach for pair 2 — whatever is
decided there will also need its losing variant's SKU renamed (or the
variant/product genuinely merged), not just deactivated, before the
migration can succeed.

## 7. All executed SKU renames, current final state (pairs 1 and 3 only)

| Variant id | Belongs to | Original SKU | Final SKU (after both passes) |
|---|---|---|---|
| `6aabced343c6b6f5ddf6ffb2` | Burqa newer (archived, `is_active=0`) | `BUR-SAU-NVY-FS-NIDA` | `BUR-SAU-NVY-FS-NIDA-DUP-f6ffb2` |
| `6aa0bd5702281c362b1784f7` | Jeans **older** (archived, `is_active=0`) | `JNS-STR-BLU-L` | `JNS-STR-BLU-L-ARCHIVED-1784f7` |
| `6aabced3342e280f47f6ffd1` | Jeans **newer** (now the live, active listing) | `JNS-STR-BLU-L` | `JNS-STR-BLU-L` (round-tripped: renamed to `-DUP-f6ffd1` in the first pass, restored to canonical in this pass) |

For Jeans specifically, the archived SKU ended up on the **older** record
rather than the newer one — the opposite of the Burqa pair — because this
session's instruction was to make the newer record canonical and the older
one the archive, matching which record is actually purchasable.

## 8. Rollback — and its limits once the UNIQUE constraint is eventually installed

**Right now (constraint not installed):** every change above can be
reverted with the exact inverse `UPDATE` (original values are recorded in
the "before" columns throughout this document and in git history). No row
was deleted; no order/review history was touched.

**Once the `UNIQUE` constraint IS eventually installed** (after pair 2 is
resolved and migration `0002` succeeds): reverting any of the archived-SKU
renames in section 7 back to a value another live row still holds will **fail** — that would
recreate the exact duplicate the constraint exists to prevent, and MySQL
will reject the `UPDATE` with `ER_DUP_ENTRY`. At that point, "rollback" of
the SKU rename specifically is not reversible without first reactivating
the constraint's exception process (i.e., dropping the constraint again,
or permanently retiring one of the two SKUs) — this is an inherent,
one-way property of adding a uniqueness guarantee, not a flaw in this
repair. The category/`is_active` changes remain freely reversible either way.

## 9. Unexplained price differences — summary

| Pair | Older price | Newer price | Verdict |
|---|---|---|---|
| Burqa | base 65, discount 55 (variant override 4000 is bad display-only data, does not affect checkout) | base 65, no discount | Resolved — see `docs/CURRENCY_MIGRATION_PLAN.md` §8/§9: migrated to 7800/6600 BDT; variant 4000 confirmed as real BDT, not display-only anymore |
| Hijab | 5000 | 18 | **Resolved 2026-09-18** — see `docs/CURRENCY_MIGRATION_PLAN.md` §9: 5000 confirmed correct (as BDT, not USD); newer record (3 colors) is now canonical/active at ৳5,000; older record archived, SKU freed |
| Jeans | 30 | 30 | Match; fully resolved and re-verified (section 3) — the earlier availability regression from the first pass is corrected |

## 10. Final status (2026-09-18)

All three duplicate pairs are now fully resolved, and migration
`0002_product_variants_sku_unique` was run successfully — confirmed via
`information_schema` (`uq_product_variants_sku`, `non_unique=0`) and a
live reproduction (an attempted duplicate-SKU insert was correctly
rejected with `ER_DUP_ENTRY`, then rolled back). Zero duplicate SKUs exist
anywhere in the catalog. See `docs/CURRENCY_MIGRATION_PLAN.md` for the
Hijab/Burqa migration's exact execution record.
