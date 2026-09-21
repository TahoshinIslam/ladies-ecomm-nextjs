/**
 * Fails when a query touches a shared table without naming the organization.
 *
 * This app's database is shared with the admin dashboard and with other
 * stores. A query that forgets `organization_id` does not error, return
 * nothing, or look wrong in review — it quietly serves another shop's
 * products, customers or orders to this shop's visitors. There is no runtime
 * signal for that, so the check has to be static.
 *
 * It reads every SQL string literal under the directories below, works out
 * which tables it
 * touches, and requires the statement to mention `organization_id` whenever
 * one of them is tenant-scoped. Crude on purpose: it cannot tell a correct
 * scope from a decorative mention of the column, so it proves only that the
 * question was asked at every site. What it does catch is the whole class of
 * mistake that matters here — a site where nobody asked at all.
 *
 *   node scripts/checkTenantScoping.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Tables carrying organization_id in the shared schema. */
const TENANT_TABLES = new Set([
  "addresses", "attribute_definition_categories", "attribute_definition_label_overrides",
  "attribute_definition_options", "attribute_definitions", "brands", "cart_items", "carts",
  "categories", "coupon_categories", "coupon_usages", "coupons", "customer_sessions",
  "customers", "deleted_products", "notifications", "order_items", "orders", "payments",
  "product_attributes", "product_variants", "products", "promotions", "rate_limit_counters",
  "review_helpful_votes", "reviews", "store_settings", "storefront_events",
  "storefront_themes", "wishlist_items", "wishlists",
]);

/**
 * Tables that were renamed on the way into the shared schema. Referencing the
 * old name is always a bug now: either the table does not exist, or — worse —
 * it exists and belongs to the dashboard.
 */
const RENAMED = {
  users: "customers",
  sessions: "customer_sessions",
  settings: "store_settings",
  themes: "storefront_themes",
  events: "storefront_events",
  schema_migrations: "storefront_migrations",
};

/**
 * Tables the dashboard soft-deletes. A row with `deleted_at` set is gone as
 * far as the shop is concerned, but it is still in the table — so a
 * storefront SELECT that does not exclude it keeps selling a product the
 * owner deleted this morning.
 */
const SOFT_DELETED = new Set([
  "addresses", "attribute_definitions", "brands", "categories", "coupons",
  "customers", "orders", "products", "promotions", "reviews", "storefront_themes",
]);

const SQL_START = /\b(SELECT|INSERT\s+(?:IGNORE\s+)?INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\b/i;
const TABLE_REF = /\b(?:FROM|JOIN|INTO|UPDATE)\s+`?([a-z_][a-z0-9_]*)`?/gi;

/**
 * Where SQL lives. `models/` is most of it, but not all: analytics builds
 * its own aggregates, and the expiry sweeper deletes by table name. A check
 * that only read models/ would have passed a dashboard query selecting
 * `FROM users` — a table this app no longer owns.
 */
const ROOTS = ["models", "services", "lib", "app"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

const failures = [];

function* sourceFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (/\.(js|jsx|mjs)$/.test(entry)) yield full;
  }
}

/**
 * Pull string and template literals out of JavaScript source.
 *
 * Written as a scanner rather than a regex because an apostrophe inside a
 * comment — `the caller's transaction` — opens a string that a regex happily
 * runs to the next quote several lines down, swallowing real SQL on the way
 * and reporting it at the wrong line. That produced a phantom finding on
 * already-correct code, which is the fastest way to teach everyone to ignore
 * this check.
 */
function stringLiterals(source) {
  const found = [];
  let i = 0;
  let line = 1;

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "\n") { line += 1; i += 1; continue; }

    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }

    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const startLine = line;
      let value = "";
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") { value += source[i + 1] ?? ""; i += 2; continue; }
        if (source[i] === "\n") line += 1;
        value += source[i];
        i += 1;
      }
      i += 1;
      found.push({ value, line: startLine });
      continue;
    }

    i += 1;
  }

  return found;
}

/**
 * Resolve `${NAME}` against `const NAME = "…"` in the same file.
 *
 * A model that factors a shared predicate into a constant is doing the right
 * thing, and a check that punished it would push the SQL back to being
 * copied into every statement. Only single-identifier interpolations of
 * file-level string constants are substituted; anything computed (a built
 * WHERE clause, a joined list of placeholders) is left as-is and still has
 * to name the column itself, because there is no way to know from here what
 * it will hold at runtime.
 */
function resolveConstants(sql, source) {
  return sql.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (whole, name) => {
    const declaration = new RegExp(`const\\s+${name}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`[^\`]*\`)`).exec(source);
    return declaration ? declaration[1].slice(1, -1) : whole;
  });
}

for (const path of ROOTS.flatMap((r) => [...sourceFiles(join(process.cwd(), r))])) {
  const file = relative(process.cwd(), path);
  const source = readFileSync(path, "utf8");

  for (const { value: raw, line } of stringLiterals(source)) {
    const sql = resolveConstants(raw, source);
    if (!SQL_START.test(sql)) continue;

    const tables = new Set();
    for (const match of sql.matchAll(TABLE_REF)) tables.add(match[1].toLowerCase());

    // A statement may say, in SQL, that it means the dashboard's own table
    // rather than the storefront's — the staff fan-out reads `users` on
    // purpose. Spelled out in the query so the intent travels with it.
    const deliberate = /\/\*\s*dashboard-table\s*\*\//.test(sql);

    for (const table of tables) {
      if (RENAMED[table] && !deliberate) {
        failures.push({
          file, line, table,
          reason: `\`${table}\` no longer exists — it is \`${RENAMED[table]}\` in the shared schema`,
        });
      }
    }

    const scoped = [...tables].filter((t) => TENANT_TABLES.has(t));
    if (scoped.length && !/organization_id/i.test(sql)) {
      failures.push({
        file, line, table: scoped.join(", "),
        reason: "touches a shared table without naming organization_id",
        sql: sql.replace(/\s+/g, " ").trim().slice(0, 100),
      });
    }

    const soft = [...tables].filter((t) => SOFT_DELETED.has(t));
    if (soft.length && /^\s*SELECT\b/i.test(sql.trim()) && !/deleted_at/i.test(sql)) {
      failures.push({
        file, line, table: soft.join(", "),
        reason: "reads a soft-deletable table without excluding deleted_at",
        sql: sql.replace(/\s+/g, " ").trim().slice(0, 100),
      });
    }
  }
}

if (!failures.length) {
  console.log(`Tenant scoping: every query in ${ROOTS.join("/, ")}/ names its organization.`);
  process.exit(0);
}

const byFile = new Map();
for (const f of failures) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);

console.log(`\n${failures.length} unscoped or stale quer${failures.length === 1 ? "y" : "ies"}:\n`);
for (const [file, items] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${file}  (${items.length})`);
  for (const i of items) {
    console.log(`      line ${String(i.line).padEnd(4)} ${i.table} — ${i.reason}`);
    if (i.sql) console.log(`               ${i.sql}`);
  }
  console.log("");
}
process.exit(1);
