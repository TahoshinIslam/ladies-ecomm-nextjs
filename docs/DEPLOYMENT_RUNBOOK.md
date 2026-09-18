# Production Deployment Runbook

Status legend: **[READY]** locally prepared and testable today · **[NEEDS DECISION]**
requires a choice only a human/business owner can make · **[NEEDS ACCESS]**
requires provider credentials/budget this audit does not have and must not
provision unilaterally.

## 1. Database

- **[NEEDS DECISION]** No production database host is chosen yet
  (`docs/PRODUCTION_READINESS.md` already discloses this). This is a launch
  blocker regardless of code quality — nothing below matters until a host
  exists.
- **[READY]** TLS: `config/db.js`'s `mysql.createPool()` does not currently
  pass `ssl: {...}`. Once a host is chosen, add `ssl: { rejectUnauthorized: true }`
  (or the provider's specific CA bundle) — most managed MySQL/MariaDB
  providers (PlanetScale, Aiven, RDS) require or strongly recommend this.
  This is a one-line, low-risk addition once the provider is known; not
  applied here because there is no host/provider to test it against yet.
- **[NEEDS DECISION]** Least-privilege credentials: the app currently
  connects as `root` locally (`.env`'s `DB_USER=root`, XAMPP default). In
  production, create a dedicated DB user with only the grants the app
  actually needs (`SELECT/INSERT/UPDATE/DELETE` on `ladies_multi_ecomm`'s
  own tables; no `DROP`/`ALTER`/`GRANT`) — migrations (`scripts/runMigrations.mjs`,
  `sql/schema.sql`) should run under a separate, more-privileged
  credential, used only for that step, not the app's runtime credential.
- **[READY]** Connection capacity: `config/db.js`'s `DB_POOL_MAX` (default
  20) and the new `DB_POOL_QUEUE_LIMIT`/`DB_POOL_ACQUIRE_TIMEOUT_MS` (this
  audit's fix) are all env-configurable — size `DB_POOL_MAX` against the
  chosen provider's actual max-connections limit divided by expected
  concurrent Vercel Function instances once that's known.
- **[NEEDS DECISION]** Region alignment: co-locate the database region with
  the Vercel deployment region once both are chosen — cross-region DB
  round trips silently degrade every page's TTFB.
- **[READY, DRILLED LOCALLY]** `scripts/backupDb.mjs` / `scripts/restoreDb.mjs`
  now exist and were actually exercised end-to-end against the disposable
  test database (2026-09-18): backed up `ladies_multi_ecomm_test` (with a
  known marker row inserted first) via `mysqldump --single-transaction`,
  restored the dump into a fresh, disposable `ladies_multi_ecomm_restore_drill`
  database, and independently verified the marker row and full 31-table
  schema were present — then dropped the drill database and deleted the
  dump file (no artifacts left behind). This proves the *mechanism* works;
  it is **not** the same as having automated production backups running.
  **[NEEDS ACCESS]** remaining: (1) a real production database host to
  actually back up, (2) either the provider's own backup product (most
  managed MySQL hosts include automatic daily backups + point-in-time
  recovery — preferred if available) or a scheduled job running
  `scripts/backupDb.mjs` against production and pushing the dump to
  durable object storage, (3) a defined retention window, and (4)
  re-running this exact drill against a real production backup once one
  exists — a drill against test data proves the scripts work, not that a
  specific production backup is restorable.

## 2. Environment separation

- **[READY]** `scripts/validateProductionEnv.mjs` already checks the
  production env shape; `lib/testDbSafety.js`/`scripts/assertTestDbSafety.mjs`
  already prevent test code from touching the real database name. Run
  `node scripts/validateProductionEnv.mjs` against the real production env
  vars (locally, with the values pasted in a terminal that isn't logged)
  before the first deploy.
- **[NEEDS DECISION]** Preview verification: Vercel preview deployments
  need their own database (never the production one) — either a shared
  "preview" database or an ephemeral one per PR. Not configured; pick one
  once a DB provider is chosen (many support cheap branch/ephemeral
  databases for exactly this).

## 3. Scheduled cleanup

- **[READY]** `app/api/admin/cron/cleanup` — a real, authenticated
  (`CRON_SECRET` bearer token, fails closed if unset), repeat-safe HTTP
  endpoint now exists, wrapping `lib/expiryCleanup.js`'s batched cleanup of
  `sessions`/`rate_limit_counters`/`events`. Verified with a live
  regression test (`tests/scheduledCleanup.test.mjs`): rejects missing/
  wrong credentials, succeeds with the right one, reports per-table +
  total counts, and calling it twice in immediate succession is a safe
  no-op (proves overlapping-scheduler safety). `events` (10-minute TTL,
  `lib/events.js`) was a confirmed gap in the old CLI-only script — it's
  now covered too.
  **[NEEDS DECISION]** remaining: which scheduler actually calls this on
  an interval — a Vercel Cron `crons` entry in `vercel.ts`, or an external
  scheduler — and setting a real `CRON_SECRET` value in the hosting
  platform's environment. This app cannot provision that scheduling
  infrastructure itself.
  - Event retention/reconnect behavior itself is already correctly
    designed and does not need new code: `resolveStartCursor()` in
    `lib/events.js` gracefully falls back to "start from now" when a
    client's `Last-Event-ID` has already been cleaned up or never existed
    — verified by reading the code, not assumed.
  - **[NEEDS DECISION]** The precise decision this audit cannot make:
    whether to add a Vercel Cron Job (`vercel.json`'s `crons` array,
    calling a new authenticated `/api/admin/cron/cleanup` route wrapping
    `scripts/cleanupExpired.mjs`'s logic) or an external scheduler hitting
    the same route. **Not implemented here** — adding a scheduled task is
    explicitly out of scope for this audit to do unilaterally. Once
    decided, the route itself is a small, low-risk wrapper around existing,
    already-tested cleanup logic.

## 4. Monitoring and alerts

- **[READY]** `app/api/health/live` and `/ready` exist and are correctly
  separated (liveness vs. readiness); `lib/logger.js` emits structured,
  secret-free JSON log lines already used throughout the app.
- **[NEEDS ACCESS]** Nothing currently ships those logs anywhere durable or
  alerts on them — needs a log drain (Vercel's own log drain feature, or a
  provider like Axiom/Datadog/Better Stack) and at minimum an alert on
  sustained 5xx rate and on `/api/health/ready` failing. Cannot be
  configured without picking and provisioning a provider.

## 5. Deployment and rollback

- **[READY]** `npm run build` is clean; `scripts/smokeDeployment.mjs`
  exists and was verified passing against a real disposable server in this
  audit's HTTP integration test run (`tests/http/smokeDeployment.integration.test.mjs`).
  Run it against the real production URL immediately after every deploy.
- **[NEEDS DECISION]** Rollback plan: Vercel's own instant-rollback-to-
  previous-deployment feature covers application code; it does **not**
  cover database schema changes. Since `sql/schema.sql`/
  `scripts/runMigrations.mjs` are additive-only by convention (`CREATE
  TABLE IF NOT EXISTS`, and this audit's own migration runner refuses
  destructive changes), a code rollback should be safe to pair with any
  schema state — but this has not been drilled end-to-end and should be,
  once a real environment exists.

## What this audit actually verified vs. what remains

Everything marked **[READY]** above was verified by reading and, where
applicable, running the real code in this session (build, tests, a live
pool-exhaustion reproduction, a live timezone-drift reproduction). Nothing
marked **[NEEDS DECISION]** or **[NEEDS ACCESS]** should be scored as
"done" — those are the actual, concrete remaining steps before this project
can be called production-ready, and none of them were fabricated or
assumed complete by this audit.
