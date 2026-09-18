# BDT-Only Currency Migration — Audit, Plan, and Execution Record

Read-only audit against the real dev database and source code, commit
`9aed53c` + this session's fixes, 2026-09-18.

**EXECUTED 2026-09-18** (after approval of the 13-row table below):
migration `0003_bdt_price_currency` ran successfully against the dev
database. Migration `0002` (SKU uniqueness) was **not** run and remains
correctly blocked on the still-unresolved Hijab SKU conflict. Hijab and
Burqa prices were **not** touched. See "Execution record" at the end of
this document for exact verification evidence.

## 1. Current architecture — three independent currency-conversion layers found

The app is not "mixed-currency by accident" — it's a deliberately-designed
dual-currency system (`views/admin/SettingsPage.jsx`'s own help text:
*"Product prices are stored in USD. This rate converts to BDT for BD
customers."*) with **three separate implementations of the same USD→BDT
conversion**, which is itself worth eliminating down to one:

1. **Client display** — `lib/currency.js`'s `usdToBdt()`/`formatMoney()`,
   exposed via `context/SettingsContext.jsx`'s `formatPrice()`/`toBdt()`.
   Used by `components/product/ProductCard.jsx`, `views/CartPage.jsx`,
   `views/product/ProductDetailInteractive.jsx` (via `resolveVariantPricing()`),
   `components/product/ProductFinder.jsx`'s budget-quiz thresholds.
2. **Server checkout** — `services/orderService.js`'s `regionFromCountry()`
   + `toRegionCurrency()` + `chargePriceUsd()`: for a `BD`-region order,
   converts catalog USD to BDT at checkout; for `INTL`, charges the raw USD
   value directly — a **genuinely different billing currency**, not just a
   display difference. This is also where `settings.shippingZones`'
   INTL/USD tier (`baseCost: 25, freeAbove: 200`, i.e. real USD shipping
   costs) and `settings.taxRules`' INTL rule live.
3. **Checkout-page compatibility shim** — `views/CheckoutPage.jsx`'s own
   `toBdtTotal()`, added specifically so the checkout UI never shows a
   dollar sign even for the rare INTL/USD server response — converting
   the server's USD totals back to BDT a second time, client-side, for
   display only (the actual order this places is still USD-denominated
   server-side).

**Historical order data has never actually exercised the INTL/USD path**:
every one of the 6 real orders in this database is `region=BD,
currency=BDT`; every one of the 4 real payments is BDT. The INTL/USD
billing path exists in code but has zero historical rows to reconcile.

## 2. Catalog price audit — the "mixed" data, quantified

Full enumeration of every price-bearing row (14 products, 3 variant price
overrides, 0 coupons):

| Products (base_price) | Count | Pattern |
|---|---|---|
| 8 – 82 (plausible USD) | 13 of 14 | Consistent with the documented "stored in USD" convention |
| 5000 (implausible as USD) | 1 of 14 | Instant Jersey Hijab (older record, `6a98b4cc1dff0db712d98f4a`) — **already flagged as unresolved, excluded from this plan** |

| Variant price overrides | Count | Pattern |
|---|---|---|
| 72, 78 (plausible USD) | 2 of 3 | Consistent with their sibling products' base prices |
| 4000 (implausible as USD) | 1 of 3 | Saudi-Style Closed Burqa, Navy/Nida variant (`6aa5d102f94acdc8bb8c483c`) — **already flagged as unresolved, excluded from this plan** |

This confirms your instruction precisely: **13 of 14 products and 2 of 3
variant overrides are genuinely USD-denominated** and need `× 120`
(current `settings.currency.usdToBdt` rate) to become correct BDT values.
**Exactly the 2 already-known anomalies must NOT be auto-converted** — one
more `×120` would make an already-wrong number 120× more wrong (this is
precisely how the Hijab record came to display ৳600,000 and the Burqa
variant ৳480,000 as "was" prices in the first place — someone, at some
point, entered a BDT-scale number directly into a USD-labeled field and it
then got treated as USD everywhere downstream).

**Coupons: 0 rows exist.** No historical reconciliation needed; the
migration should still fix the code-level inconsistency where a flat
coupon `discountValue` is currently applied directly against an
already-region-converted `subtotal` with no currency normalization of its
own (moot today, but would be a latent bug the moment a real coupon is
created).

## 3. Exact proposed before/after table (excludes Hijab + Burqa entirely, per instruction)

| Product | id | Field | Before (USD) | Proposed after (BDT, ×120) |
|---|---|---|---|---|
| Classic Crew Neck T-Shirt | `6aabced3c68dbe26a7f6ffc6` | base_price | 8 | 960 |
| Double-Layer Chiffon Niqab | `6aabced323e0c279daf6ffb7` | base_price | 15 | 1800 |
| Relaxed Casual Shirt | `6aabced3e95bd02011f6ffcc` | base_price | 16 | 1920 |
| Oxford Formal Shirt | `6aabced392bbf77758f6ffc9` | base_price | 20 | 2400 |
| Slim Fit Skinny Jeans | `6aabced3b5cd1a4c57f6ffce` | base_price | 28 | 3360 |
| Relaxed Straight Jeans (active) | `6aabced35f18d2df60f6ffd0` | base_price | 30 | 3600 |
| Relaxed Straight Jeans (archived) | `6aa0bd5702281c362b1784f6` | base_price | 30 | 3600 |
| Two-Layer Tiered Khimar | `6aabced33991c9bd12f6ffbf` | base_price | 34 | 4080 |
| Open-Front Nida Abaya | `6aabced3ed0cb986ebf6ffba` | base_price | 68 | 8160 |
| Open-Front Nida Abaya | (same) | variant `6aabced3def4762f4bf6ffbd` price | 78 | 9360 |
| Abaya & Hijab Matching Set | `6aabced34a703c58eaf6ffc3` | base_price | 82 | 9840 |
| Saudi-Style Burqa (archived dup) | `6aabced3da7ef41850f6ffaf` | base_price | 65 | 7800 |
| Saudi-Style Burqa (archived dup) | (same) | variant `6aabced3f6e476582df6ffb1` price | 72 | 8640 |

**Excluded entirely (per your instruction — no value proposed until you resolve them):**
- `6a98b4cc1dff0db712d98f47` (Burqa, active) — `base_price=65, discount_price=55`, AND its variant `6aa5d102f94acdc8bb8c483c` (`price=4000`).
- `6a98b4cc1dff0db712d98f4a` (Hijab, active) — `base_price=5000`.

I excluded the Burqa *product-level* 65/55 too, not just the anomalous
variant, since your instruction named "Burqa prices" broadly — those two
values individually look like ordinary, correctly-USD-denominated numbers
(consistent with every other product), but I'm not converting them
unilaterally while the same product's variant price is still an open
question, in case resolving the variant conflict changes how you want the
whole product priced.

These 13 rows above are the ones I'd convert once you approve — every
number is exactly `current × 120` (today's live `usdToBdt` rate), applied
once, to the specific column shown.

## 4. Orders, payments, coupons — reconciliation

**No historical order/payment amount needs to change.** All 6 orders and 4
payments are already stored as real BDT amounts (`currency='BDT'`
throughout) — they were computed by `toRegionCurrency()` at the time each
order was placed, using whatever the live rate was then, and that
historical charge is exactly what the customer was actually billed. Once
catalog prices become BDT-native, `toRegionCurrency()` is simply removed
(see section 5) — it never touches already-placed orders, only future
`calcTotals()` calls for new orders.

**Payment-provider units**: this app is COD-only (confirmed by this
audit's earlier security pass) — no card/gateway integration exists that
would need a minor-unit (paisa/poisha) conversion the way Stripe cents
would. `payments.amount` is a plain `DECIMAL(12,2)` BDT value, matching
`orders.total`. No provider-unit reconciliation is needed beyond what
already exists.

## 5. Affected code paths — proposed changes (not yet made)

| File | Current role | Proposed change |
|---|---|---|
| `lib/currency.js` | `usdToBdt()` conversion + `formatBdt()` formatting | Remove `usdToBdt()`/`formatMoney()`'s conversion entirely; keep only `formatBdt()`-style pure formatting (rename `formatMoney` if kept, to make clear it takes an already-BDT value) |
| `context/SettingsContext.jsx` | Exposes `formatPrice()` (converts) and `toBdt()` (converts) | Collapse both into one pure formatter (no rate multiplication); `rate`/`usdToBdt` no longer read here |
| `models/settingsModel.js` | `DEFAULT_CURRENCY = {defaultDisplay, usdToBdt}`, `DEFAULT_TAX_RULES`/`DEFAULT_SHIPPING_ZONES` include an `INTL`/`USD` region | Remove `currency.usdToBdt`/`defaultDisplay` (or reduce to a display-locale-only setting); **decision needed** on the INTL shipping/tax zone — see section 6 |
| `schemas/adminSchemas.js` | Settings schema validates `currency.defaultDisplay: enum(["BDT","USD"])`, `usdToBdt: number` | Remove both fields from the schema |
| `views/admin/SettingsPage.jsx` | Exchange-rate input + "stored in USD" help text | Remove the exchange-rate field entirely; update/remove the help text |
| `services/orderService.js` | `regionFromCountry()`, `toRegionCurrency()`, `chargePriceUsd()`, region-conditional `calcShipping()`/`calcTax()` | Remove `toRegionCurrency()` (catalog prices are already BDT, no conversion step); simplify `chargePriceUsd()` to a plain `effectiveCharge()` (same precedence logic, just no currency framing); **decision needed** on whether `region` (BD vs INTL) still exists for shipping-zone purposes without a currency split |
| `views/CheckoutPage.jsx` | `toBdtTotal()` compatibility shim, `toCheckoutPrice()` | Remove both — every value from the server and from the catalog is already BDT, no conversion needed anywhere in this file |
| `components/product/ProductCard.jsx` | `effectivePrice(product)` + `settings.formatPrice()` | No logic change — `effectivePrice()` already just reads `basePrice`/`discountPrice` directly; once those are BDT-native and `formatPrice()` stops converting, this is correct with zero code change beyond the shared helpers above |
| `views/product/ProductDetailInteractive.jsx`, `lib/utils.js`'s `resolveVariantPricing()` | Same pattern as ProductCard, plus variant-level `price`/`discountPrice` | No logic change needed — same reasoning |
| `views/CartPage.jsx` | `settings.formatPrice(displayPrice)` on client-computed cart totals | No logic change needed — same reasoning |
| `components/product/ProductFinder.jsx` | Budget-quiz thresholds `{lte:25}, {gte:25,lte:50}, {gte:50}` (raw USD, matches `basePrice` filter param) | Update the three threshold numbers to BDT scale: `{lte:3000}, {gte:3000,lte:6000}, {gte:6000}` (×120 of the current USD thresholds) — these must move in lockstep with the catalog price migration or the budget filter silently breaks |
| `services/couponService.js` / `services/orderService.js`'s coupon-discount branch | Flat `discountValue` applied directly against an already-region-converted `subtotal`, no currency normalization | No data to migrate (0 coupons) — but the code comment/assumption should be updated to state discounts are BDT-denominated, full stop, once the region/currency branch is gone |
| `models/paymentModel.js` / `services/paymentService.js` | `currency` column, always written as `order.currency` | Once orders are always BDT, this becomes a constant — keep the column (schema stability) but the value is no longer a real branch |
| `components/admin/ProductFormModal.jsx` (admin create/edit form) | Checked precisely: labels are already currency-agnostic ("Base price", "Discount price", "Price override") with no "$"/"USD" text anywhere | **No change needed** — only the numbers admins type will mean BDT going forward; nothing to relabel |

## 6. Business decisions needed before I execute anything

1. **Approve or amend the 13-row conversion table in section 3.** I will
   only run these `×120` updates on your explicit go-ahead, in one
   transaction, with the same before/after documentation style as the
   Jeans/Burqa category repairs.
2. **What happens to the INTL shipping zone/region?** Options, not
   recommending one: (a) drop it — the store only ships/bills
   domestically, becomes a single BDT price list with no region branch at
   all; (b) keep an "international shipping" concept but bill it in BDT
   too (convert the zone's `baseCost`/`freeAbove` from USD to BDT the same
   way as catalog prices); (c) leave the INTL code path in place,
   unconverted, as dead/unused code for a possible future re-launch. Given
   zero historical INTL orders exist, there's no data-migration urgency
   either way — this is purely a forward-looking product decision.
3. **Hijab and Burqa** remain entirely out of this migration until you
   resolve their price/currency questions from the earlier catalog repair
   report. Once resolved, their rows slot into the same conversion
   mechanism described here (or are entered directly in BDT if you decide
   they're already BDT-correct as-is).

## 7. What was explicitly NOT done this turn

- No database write of any kind.
- Migration `0002_product_variants_sku_unique` was not run.
- Hijab and Burqa prices are untouched.
- The completed Jeans repair (canonical SKU on the active listing, archived
  SKU on the inactive one) is untouched and was re-confirmed unaffected by
  this audit.

## 8. Execution record (2026-09-18)

Approved: the 13-row table in section 3. Executed via a new migration,
`scripts/migrations/0003_bdt_price_currency.mjs`.

**A real coupling risk was found and fixed before executing anything.**
This app multiplies every catalog price by the live exchange rate at
display/checkout time. Converting the 13 rows in the database while
leaving that multiplication in place would have double-converted them
(e.g. ৳960 displayed as ৳115,200); removing the multiplication globally
instead would have made Hijab/Burqa's untouched raw values display 120×
lower than today — a live, unauthorized price drop on active, purchasable
products. **Fix:** added a transitional `products.price_currency`
ENUM('USD','BDT') column (schema change in `sql/schema.sql`, migration
step in `0003_bdt_price_currency.mjs`) so migrated and not-yet-migrated
products correctly coexist: BDT-flagged products' stored prices are used
as-is everywhere (server checkout and every client display component);
USD-flagged products (only Hijab and Burqa remain) still convert via the
live rate, exactly as before this session.

**What actually changed, executed and verified:**
- `sql/schema.sql` / `scripts/migrations/0003_bdt_price_currency.mjs`:
  added `products.price_currency`, converted exactly the 13 approved
  product/variant rows (`base_price`/`discount_price`/variant `price`,
  each × 120, then flagged `'BDT'`), and converted the `settings`
  singleton's INTL shipping zone (`baseCost` 25→3000, `freeAbove`
  200→24000, also part of "remove USD conversion from the active pricing
  flow" — zero historical orders ever used this zone, confirmed before
  writing).
- `services/orderService.js`: removed the region-based currency branch
  entirely (`toRegionCurrency()`/`chargePriceUsd()` → a single
  `chargePrice()` that always returns BDT — converts only if the
  product is still USD-flagged); `orders.currency` is now always
  `"BDT"`; `roundMoney()` no longer takes a region/decimals argument.
- `models/productModel.js`: rows now expose `priceCurrency`.
  `services/cartService.js`: cart-item product summaries now include it too.
- `lib/currency.js` / `context/SettingsContext.jsx`: `formatPrice()`/
  `toBdt()` now take an explicit `currency` argument (default `"USD"` —
  fails safe into the old behavior if a call site is ever missed) instead
  of unconditionally converting.
- `lib/utils.js`'s `resolveVariantPricing()` now returns `currency` too.
- Every real product-price display call site updated to pass it through:
  `ProductCard.jsx`, `ProductDetailInteractive.jsx`, `QuickAddSheet.jsx`,
  `CartPage.jsx`, `CartDrawer.jsx`, `SearchModal.jsx`,
  `HeaderSearchField.jsx`, `ComparePage.jsx`, `admin/ProductsPage.jsx`.
  `CartPage.jsx`/`CartDrawer.jsx`'s subtotal math was also fixed to
  normalize each line to BDT *before* summing — summing raw numbers
  first (the previous pattern) would have mis-converted a mixed cart.
  `CheckoutPage.jsx`'s now-unnecessary `toBdtTotal()`/raw-USD
  compatibility shim was removed, since the server never returns a
  non-BDT total anymore.
- `ProductFinder.jsx`'s hardcoded budget-quiz thresholds moved from USD
  scale (25/50) to BDT scale (3000/6000).
- Admin Settings page help text updated to describe the transitional
  reality instead of the old "prices are stored in USD" statement.

**Verified, not assumed:**
- Full test suite: 1243/1243 pass, both before and after every code
  change above, and again after the live migration ran.
- Direct DB query after migration: all 13 rows and both variant overrides
  show the exact planned BDT values; Hijab (`base_price=5000`) and Burqa
  (`base_price=65/discount=55`, variant `price=4000`) are byte-for-byte
  unchanged.
- Browser: a migrated product (`Classic Crew Neck T-Shirt`) now shows
  ৳960 — the correct, single-converted value, not ৳8 (unconverted) or
  ৳115,200 (double-converted). Burqa's page is pixel-for-pixel identical
  to before this migration (৳6,600 / ৳480,000 / 99% OFF, unchanged).
- **Mixed-cart proof, both client and server:** with one still-USD item
  (Hijab, ৳600,000-equivalent) and one newly-BDT item (T-Shirt, ৳960) in
  the same cart, the cart page's client-computed subtotal read exactly
  ৳603,600 (600,000 + 3,600 from Jeans, also BDT-native). A direct call to
  `services/orderService.js`'s real `previewOrder()` with the same two
  products returned `subtotal: 600960` (Hijab 5000×120 + T-Shirt 960
  as-is) — both numbers match hand arithmetic exactly, proving neither a
  double-conversion nor a missed-conversion bug exists in the mixed state.
- `product_variants.sku`'s `UNIQUE` constraint remains **not** installed
  (confirmed: migration `0002` still correctly refuses, reporting only
  the one remaining, intentionally-untouched Hijab conflict).

**Known, accepted limitation (not fixed, documented):** `basePrice`-range
filtering/sorting (`services/productService.js`'s `EFFECTIVE_PRICE_SQL`,
the shop page's price-range slider, `PriceHistogramSlider.jsx`) compares
the raw stored number with no per-row currency awareness. During this
transitional period, the 2 remaining USD-flagged products (Hijab, Burqa)
will filter/sort as if their small USD numbers were BDT (i.e., always read
as "very cheap") until they're migrated too. This affects at most 2 of 14
products and was judged out of proportion to fix this session (it would
require currency-aware SQL filtering); flagged here rather than silently
left undocumented. **Update: as of section 9 below, this limitation no
longer applies — every product in the catalog is now BDT-native.**

## 9. Phase 2 execution record (2026-09-18) — Hijab and Burqa migrated, catalog now 100% BDT

Per your explicit decisions: Hijab's 5000 confirmed correct as BDT (not
USD, not the newer record's 18); Burqa's 65/55 migrated like every other
ordinary row; Burqa's variant 4000 confirmed as already-BDT (kept as-is,
only the product's currency flag changed).

Executed via `scripts/migrations/0004_bdt_hijab_burqa.mjs`:
- Burqa (`6a98b4cc1dff0db712d98f47`): `base_price` 65→7800, `discount_price`
  55→6600, `price_currency`→`'BDT'`. Variant `6aa5d102f94acdc8bb8c483c`'s
  `price` left at `4000` unchanged (the number itself was already correct;
  only its currency interpretation changed).
- Hijab newer (`6aabced3435ad98399f6ffb3`, becomes canonical/active):
  `base_price` overridden 18→5000 (a direct decision, not a ×120
  conversion), `price_currency`→`'BDT'`. Category and 3-color variant set
  (Black/Dusty Rose/Olive) left untouched.
- Hijab older (`6a98b4cc1dff0db712d98f4a`, archived): `is_active`→`0`,
  `price_currency`→`'BDT'` (data hygiene only, no live effect), colliding
  variant SKU `HIJ-INS-BLK-FS` renamed to `HIJ-INS-BLK-FS-ARCHIVED-d4c62f`.

**Verified:** direct DB query matches every value exactly; 1243/1243 tests
pass; order history for the archived Hijab record (`order_items.snapshot_*`
for both real historical orders) confirmed byte-for-byte unchanged; browser
confirms Burqa now displays a flat ৳6,600 (the `hasDiscount` flag
correctly flipped to false now that `discountPrice`(6600) is no longer
less than `price`(4000) — a correct consequence of fixing the currency
label, not a change to the pricing-precedence formula itself) and Hijab
displays ৳5,000 under its correct category with all 3 colors.

**Then, on request, migration `0002_product_variants_sku_unique` was run**
— it succeeded (zero conflicts remained after the above). Verified via
`information_schema.statistics` (`uq_product_variants_sku`, `non_unique=0`)
and a live reproduction: an attempted duplicate-SKU insert was correctly
rejected with `ER_DUP_ENTRY`, then rolled back (no data left behind).

**Every product in the catalog is now `price_currency='BDT'`.** The
`usdToBdt` exchange rate and the USD branch in `chargePrice()`/
`formatPrice()`/`toBdt()` are no longer exercised by any real data, but
were deliberately left in place (not deleted) — they are dead code now,
not a risk, and removing them is a separate, optional cleanup rather than
something required for correctness.
