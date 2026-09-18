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

**Final score: 90/100** (was 85/100 at the start of this pass). Full
breakdown and evidence in the chat response this document accompanies.
