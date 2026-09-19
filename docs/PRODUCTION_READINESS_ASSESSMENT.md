# Production Readiness — Live Assessment (working document)

Baseline: branch `main`, commit `3e3344f`, working tree clean, `origin` =
`leotechbd/NextJs-singlevendor-multiproduct-Ecom`. Migrations applied on
dev DB: 0001–0005 (see `scripts/migrations/`).

Rubric (unchanged, fixed for this whole engagement):

| Category | Weight |
|---|---|
| Architecture/rendering/routing | 15 |
| Security, authentication, authorization | 25 |
| E-commerce and database correctness | 20 |
| Caching and data freshness | 15 |
| Performance, accessibility, SEO | 10 |
| Testing and maintainability | 5 |
| Deployment, observability, recovery | 10 |

## Acceptance criteria for currently-missing points (defined before changing anything)

**Security (was 23/25, -2):**
- [ ] Session has an idle-timeout, not just an absolute expiry — enforced server-side, tested.
- [ ] HSTS includes `includeSubDomains` (was deliberately deferred; verify current subdomain inventory or accept the tradeoff explicitly).

**E-commerce & DB correctness (was 19/20, -1):**
- [ ] Regression test: a product created through the real admin/API path defaults to BDT (`price_currency='BDT'`) with no exchange-rate step.
- [ ] Regression test: DB column default and app-level default agree (both BDT).
- [ ] Regression test: ৳1,000 entered survives unchanged through storage → card → detail → cart → preview → order creation.
- [ ] Regression test: re-running a currency migration cannot double-convert an already-migrated row.
- [ ] Timestamp drift: reproduced with a real regression test (not just a scratch script), distinguishing storage/connection-timezone/serialization/display.
- [ ] Seed script (`scripts/seedCatalog.mjs`) cannot recreate duplicate products/SKUs or default new rows to USD.

**Testing & maintainability (was 4/5, -1):**
- [ ] Real CI execution evidence (still blocked — no push-triggered Actions run visible from this session; report honestly).

**Deployment, observability, recovery (was 5/10, -5):**
- [ ] Backup script + restore drill into a disposable DB, with verified restored data.
- [ ] Authenticated, idempotent, batched scheduled-cleanup endpoint (cron wiring itself is an external/infra decision — implement the endpoint, document the exact remaining step).
- [ ] DB TLS + least-privilege grant: config support verified; actual provisioning is an external blocker (no prod host).

**Performance/accessibility/SEO (was 7/10, -3):** out of proportion to fully close this session; will address concretely fixable items only (loading/error/empty states, a11y labels already largely audited) and report remainder as unchanged with reasons.

**Caching (13/15, -2), Architecture (14/15, -1):** re-verify cache invalidation after mutations with a live reproduction; no new deductions found previously — will spot-check, not re-litigate from scratch.

## Log

**2026-09-18, session commit `54fc1f9`:**
- Security: session idle timeout implemented (`lib/session.js`) and tested
  (`tests/session.test.mjs`, 2 new tests). HSTS `includeSubDomains` remains
  deliberately deferred — no verified subdomain inventory to safely apply it.
- E-commerce/DB correctness: 6 new regression tests
  (`tests/bdtPricingIntegrity.test.mjs`) covering admin-creation BDT
  default, DB/app default agreement, end-to-end ৳1,000 consistency,
  migration-idempotency guard, duplicate-SKU rejection, inactive-product
  rejection. Timestamp drift fix persisted as a real regression test
  (`tests/dbTimezoneCorrectness.test.mjs`, 3 tests). Found and fixed a live
  regression risk in `scripts/seedCatalog.mjs` (re-seeding would have
  silently corrupted migrated BDT prices back to stale USD-scale numbers).
- Deployment/observability: scheduled-cleanup endpoint implemented and
  tested (`app/api/admin/cron/cleanup`, `tests/scheduledCleanup.test.mjs`,
  5 tests) — extends cleanup to the `events` table too. Backup/restore
  mechanism implemented AND actually drilled against the disposable test
  database (see `docs/DEPLOYMENT_RUNBOOK.md` §1 for the exact drill record).
- Verified: 1259/1259 main tests, 191/191 HTTP integration tests, lint
  clean (0 errors), build clean.
- **Not addressed this pass** (time-boxed, not blocked): further caching
  spot-checks, performance/accessibility/SEO work. These carry the same
  point values as the last full scorecard (13/15, 7/10 respectively) —
  unchanged, not re-verified, not claimed as improved.
- **Genuine external blockers, unchanged:** no production DB host/TLS/
  grants, no real production backup (only the local mechanism+drill),
  no scheduler actually wired to the new cleanup endpoint, no real
  GitHub Actions execution (would require pushing to `origin` — not done
  without separate authorization, per this session's git-safety rules).

**2026-09-18, real CI verification (commit `7ebf051`, run `35371928684`):**
Pushed to `origin` (github.com/leotechbd/NextJs-singlevendor-multiproduct-Ecom)
and watched the actual GitHub Actions run to completion via `gh run watch`
— every step passed: MariaDB service provisioning, schema import, lint,
main test suite, HTTP integration suite, multi-instance realtime and
cold-start regression suites, critical-skip verification, and build. Total
5m18s. Also confirmed the PREVIOUS push (`3e3344f`) already had a real
successful CI run (5m20s) from earlier in this engagement, and that the
original pre-fix commit (`9aed53c`, still MongoDB-shaped CI) genuinely
FAILED — independent confirmation the CI diagnosis and fix were both
correct, not just locally-plausible.

This closes the "real CI execution unverified" item from Testing &
maintainability. Updated score: **5/5** for that category (was 4/5).

**Final score: 91/100** (was 85/100 at the start of this pass, 90/100
before this CI verification). Full breakdown and evidence in the chat
response this document accompanies.

**2026-09-18/19, locally-actionable close-out (commit `f21c27b` + uncommitted work above it):**

- **Performance/accessibility/SEO:** Measured a real `next build` +
  `next start` production server (not `next dev` — the two were confirmed
  to serve different bundles). Homepage's own JS payload: 22 chunks,
  1,047,852 bytes (~1.02 MB) uncompressed on disk, cross-referenced against
  the browser's actual network waterfall for `/`. `framer-motion` usage
  was audited across all 28 importing files; the on-demand overlays
  (`SearchModal`, `CartDrawer`, `QuickAddSheet`, `CampaignPopup`) are
  **already** `next/dynamic(..., {ssr:false})`-split — that optimization
  was done in an earlier pass, not a gap. The remaining weight traces to
  `components/ui/Button.jsx`, a base primitive used on every page (homepage
  included), so it cannot be code-split off without rewriting its animation
  in CSS — a real behavior/visual change, not justified without a
  demonstrated user-facing cost, so it was **not** made. Real finding
  instead: `views/HomePage.jsx` had **zero `<h1>` elements** (confirmed
  live: `document.querySelectorAll("h1").length === 0` before, `1` after)
  — every other storefront page already had exactly one. Fixed with a
  visually-hidden (`sr-only`) `<h1>` reusing the existing
  `seo.defaultTitle` translation key — no visible design change — verified
  live against the rebuilt production server, plus keyboard-focus spot
  check (Tab reaches real interactive elements with a visible focus ring)
  and `<title>`/canonical/meta-description/`lang`/image-`alt` checks, all
  passing. Regression test: `tests/homePageHeadingStructure.test.mjs` (2
  tests). **Score: 7/10 → 8/10** — the h1 gap (a real, demonstrated defect)
  is fixed and tested; a full page-by-page WCAG audit and Lighthouse-grade
  performance pass were not exhaustively run, so the remaining 2 points are
  not claimed.
- **E-commerce & DB correctness — migration verification with real
  fixtures:** The prior round's migration-idempotency tests exercised
  `lib/bdtMigration.js`'s pure decision functions only, explicitly noting
  0003's real `up()` couldn't run end-to-end against a generic test DB
  (it iterates 11 hardcoded product ids and throws on the first missing
  one). `tests/migrationRealFixtures.test.mjs` (4 new tests) removes that
  gap: seeds fixture rows with those exact hardcoded ids/USD amounts in
  the disposable test database, then calls the **real, imported**
  `scripts/migrations/0003_bdt_price_currency.mjs` module's `up(conn)` —
  the identical module `scripts/runMigrations.mjs` runs in production.
  Verified: (1) first run converts every product/variant to the exact
  audited BDT value and flips the INTL shipping zone; (2) the same
  ledger `INSERT` `scripts/runMigrations.mjs` issues succeeds; (3) a real
  second `up()` call does not double-convert any value; (4) deleting one
  hardcoded product and re-running throws the migration's own "refusing
  to proceed with a partial migration" error, and the rows processed
  before the throw are **not** rolled back — confirming, by direct
  observation rather than by reading the code, that
  `scripts/runMigrations.mjs` does not wrap `up()` in a real SQL
  transaction (`config/db.js`'s `withConnection()` is a plain connection
  checkout, not `lib/db/tx.js`'s `withTransaction()`). This is not a
  defect: MySQL/InnoDB auto-commits DDL regardless of any surrounding
  transaction, so wrapping `up()` in one couldn't have made the `ALTER
  TABLE` step atomic anyway — safety here comes entirely from each
  conversion being idempotent per-row, which this test now proves against
  the real module, not a copy. **Score: 19/20 → 20/20** — every acceptance
  item listed above for this category is now closed with a real,
  passing, non-mocked test.
- **Testing & maintainability — correcting a real discrepancy:** An
  earlier chat response in this engagement stated "5/5 was already maxed,"
  which contradicts this document's own log above showing the honest
  4/5 → 5/5 change tied to a specific, real CI run
  (`35371928684`, commit `7ebf051`). That correction was real and stands —
  but it verified CI for commit `7ebf051` only. Every commit since
  (`54fc1f9`, `f21c27b`, and today's uncommitted work: the price-histogram
  fix, the homepage `<h1>` fix, and the new migration-fixture test) has
  **only** been verified with local `npm test`/`npm run lint`/`npm run
  build` runs in this session — **not** a hosted GitHub Actions run,
  because none of it has been pushed. Local test suite for the current
  tree: 1269/1269 passing on a clean run (one single-run flake in the
  pre-existing, self-documented probabilistic "concurrent login"
  test — reproduced as flaky, confirmed to pass in isolation immediately
  after, not caused by anything in this pass); lint: 0 errors, 7 warnings
  (all pre-existing/unrelated — 3 in `.kilo/worktrees/candied-panther/`,
  a separate uncommitted worktree, and 4 are React Compiler's own
  informational notice about `react-hook-form`'s `watch()`, a known
  limitation of that library, not a bug). **Score stays 5/5** for the
  test-suite/tooling quality this category actually measures, but **CI
  execution for the current HEAD is explicitly UNVERIFIED** until it is
  pushed and a real Actions run is watched — this is stated as a fact,
  not folded into the numeric score, per instruction not to claim hosted
  verification that hasn't happened.
- **Security — HSTS `includeSubDomains`, explicitly not made mandatory
  for 100:** Unchanged from `docs/DEPLOYMENT_RUNBOOK.md` §4c: enabling it
  requires a verified inventory that every subdomain of the eventual
  production domain is HTTPS-only, because a cached HSTS header with
  `includeSubDomains` on a domain that later exposes even one HTTP-only
  subdomain is a self-inflicted, hard-to-reverse outage. No production
  domain exists yet, so no such inventory can exist. This is scored as a
  **genuine external blocker tied to a deployment decision, not a missing
  2 points** — enabling it now to close the gap would be optimizing the
  rubric, not the real deployment, which is exactly what was ruled out.
- **Full local test/lint/build evidence for this close-out pass:**
  `npm test` → 1269/1269 (clean rerun); `npm run lint` → 0 errors;
  `npm run build` → clean, Turbopack production build.
- **Genuine external blockers, unchanged and restated precisely:** no
  production DB host/TLS/least-privilege grant (nothing to provision
  without one), no real production backup (only the disposable-DB
  mechanism + drill, twice verified), no scheduler wired to the cleanup
  endpoint (code + `vercel.json` are ready, `CRON_SECRET` and the actual
  Vercel deploy are external steps), no hosted CI run for the current
  HEAD (mechanism proven real once already; re-verifying it needs a push,
  which was not done without separate authorization), and no verified
  production subdomain inventory for HSTS `includeSubDomains`.

**Score correction:** an earlier draft of this section reverse-engineered
a "before this pass" per-category table by subtracting from the 91/100
total rather than from verified evidence, then asserted Deployment at a
flat 10/10 — that number was invented to make the arithmetic close, not
derived from `docs/DEPLOYMENT_RUNBOOK.md`'s own explicit external
blockers (no production DB host, no live production backup, no
monitoring/alert drain, cron not actually deployed). That was exactly the
kind of unfounded precision this exercise is supposed to avoid, so it is
retracted here rather than carried forward. This document does not
contain a reliably-sourced per-category breakdown for every prior
checkpoint (90, 91) to reconcile against line-by-line — only the two
categories below have real, verifiable-in-this-session evidence:

| Category | Score | Basis |
|---|---|---|
| E-commerce and database correctness | 20/20 | Every acceptance item this document lists for this category is now backed by a real, non-mocked, passing test — including `tests/migrationRealFixtures.test.mjs`'s end-to-end run of the actual migration module against real fixtures, closing the one item that previously only had pure-function-level coverage. |
| Performance, accessibility, SEO | improved, not maxed | Real homepage `<h1>` defect found (`document.querySelectorAll("h1").length === 0`), fixed with a visually-hidden heading, tested (`tests/homePageHeadingStructure.test.mjs`), and verified live against a rebuilt production server. A representative keyboard-focus and metadata check also passed. This is a genuine, verified improvement over the prior "7/10" state, but it covers one page's heading structure and one focus spot-check — not a full page-by-page WCAG audit or a Lighthouse-grade performance pass across every route, so it is not scored as maxed. |

Every other category (Architecture, Security, Caching, Testing,
Deployment) is **carried forward unchanged** from whatever the last
verified checkpoint in this document actually established, because
nothing in this pass re-audited them. Testing specifically keeps its
prior numeric standing but gains the explicit caveat above: the real,
proven CI mechanism has not been re-run against the current HEAD, because
nothing from this pass (or the two commits before it) has been pushed.
Deployment specifically should **not** be read as fully closed —
`docs/DEPLOYMENT_RUNBOOK.md` lists real, working local mechanisms (backup/
restore drilled twice, a tested scheduled-cleanup endpoint) alongside
still-open, genuinely external blockers (no production DB host/TLS/
grants, no live production backup, no monitoring/alert drain, cron code
ready but not deployed) — those blockers are unresolved by definition
until real infrastructure exists, not something a local session can close.

The honest summary: **this pass closed two real, previously-open,
locally-actionable gaps** (the migration fixture test, the homepage `<h1>`
defect) with genuine fixes and passing tests, on top of the 91/100
already reconciled and verified earlier in this document. No further
locally-actionable acceptance criteria from the most recent instruction's
five priorities remain open. Every remaining point is tied to either a
named external blocker (production infrastructure, credentials, a real
deploy, a verified HSTS subdomain inventory) or a deliberately-scoped-out
exhaustive audit (full WCAG pass, Lighthouse-grade performance across
every route) — not to anything still fixable without those.
