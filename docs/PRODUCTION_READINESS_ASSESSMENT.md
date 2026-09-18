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

(appended as work proceeds)
