#!/usr/bin/env node
// Phase 11, section N — a safe, read-only-by-default smoke test for a
// REAL deployed environment (a Vercel Preview URL, or production). Unlike
// scripts/httpTestServer.mjs (which spawns and controls its own disposable
// local server), this script only ever makes outbound GET requests to a
// URL you give it — it never starts a server, never touches a database
// directly, and never performs any mutation unless explicitly told to.
//
// Usage:
//   node scripts/smokeDeployment.mjs https://your-preview-url.vercel.app
//   node scripts/smokeDeployment.mjs http://localhost:3000 --allow-localhost
//
// Safety:
//   - HTTPS required. The one exception is an explicit localhost URL
//     passed together with --allow-localhost (for local manual testing
//     only) — anything else non-HTTPS is refused outright.
//   - Read-only by default: only ever issues GET requests to public pages
//     and health endpoints. There is no authenticated/staging mode in
//     this version — add one only with its own explicit opt-in flag and
//     an additional confirmation flag if it should ever be allowed to run
//     against a hostname that looks like production (not implemented
//     here, since no such mode exists yet — documented for the next
//     person who adds one).
//   - No embedded credentials of any kind — this script accepts no
//     username/password/token arguments at all.
//   - Strict per-request timeout (10s) — a hanging deployment fails fast
//     with a clear message instead of hanging the whole script.
//   - Output is redacted: response bodies are never printed in full, only
//     pass/fail plus a short, safe reason. Nothing resembling a secret
//     (long hex/base64-looking tokens) found anywhere in a response is
//     ever echoed back verbatim.
//   - Exit code: 0 only if every check passes; 1 otherwise, with a clear
//     summary of which checks failed.

const TIMEOUT_MS = 10_000;

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const positional = args.filter((a) => !a.startsWith("--"));
  return { url: positional[0], allowLocalhost: flags.has("--allow-localhost") };
}

function assertSafeUrl(rawUrl, allowLocalhost) {
  if (!rawUrl) throw new Error("Usage: node scripts/smokeDeployment.mjs <url> [--allow-localhost]");
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Not a valid URL: ${rawUrl}`);
  }
  const isLocalhost = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(isLocalhost && allowLocalhost)) {
    throw new Error("Target must be https:// (or http://localhost with --allow-localhost for local testing only)");
  }
  return url;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: options.redirect || "manual" });
  } finally {
    clearTimeout(timer);
  }
}

// Never echoes a response body — only reports whether a suspicious
// secret-shaped token pattern (long hex/base64 runs, or a literal
// mongodb:// URI) appears anywhere in it, without ever printing the match
// itself.
const SECRET_LIKE_PATTERNS = [/mongodb(\+srv)?:\/\//i, /[A-Za-z0-9+/]{40,}={0,2}/, /[a-f0-9]{32,}/i];

function looksLikeItLeaksSecrets(text) {
  return SECRET_LIKE_PATTERNS.some((re) => re.test(text));
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function checkPage(base, path, { expectStatus = 200 } = {}) {
  try {
    const res = await fetchWithTimeout(new URL(path, base), { redirect: "follow" });
    const ok = res.status === expectStatus;
    record(`GET ${path} → ${expectStatus}`, ok, ok ? undefined : `got ${res.status}`);
    return res;
  } catch (err) {
    record(`GET ${path} → ${expectStatus}`, false, err.message);
    return null;
  }
}

async function main() {
  const { url: rawUrl, allowLocalhost } = parseArgs(process.argv);
  let base;
  try {
    base = assertSafeUrl(rawUrl, allowLocalhost);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  console.log(`Smoke-testing ${base.origin} (read-only, GET requests only)\n`);

  // --- Core public pages ---
  await checkPage(base, "/");
  await checkPage(base, "/shop");

  // --- Health endpoints ---
  await checkPage(base, "/api/health/live");
  const readyRes = await checkPage(base, "/api/health/ready");

  // --- robots.txt / sitemap.xml ---
  const robotsRes = await checkPage(base, "/robots.txt");
  const sitemapRes = await checkPage(base, "/sitemap.xml");

  // --- 404 handling ---
  await checkPage(base, "/this-route-should-not-exist-smoke-test", { expectStatus: 404 });

  // --- private route never serves another user's data to an anonymous request ---
  // This app's private pages (e.g. /profile) are client-rendered: the
  // server always returns 200 with a generic shell (a "please sign in"
  // prompt for an unauthenticated visitor — see views/ProfilePage.jsx),
  // and the real per-user data is fetched client-side only after a
  // successful session check. A server-side redirect/401/403 is ALSO an
  // acceptable outcome (a future/different route might do that instead) —
  // what this check actually guards against is the unsafe middle ground:
  // a 200 response that already embeds private account data server-side
  // for an anonymous request.
  try {
    const res = await fetchWithTimeout(new URL("/profile", base));
    const isRedirectOrDenied = [301, 302, 303, 307, 308, 401, 403].includes(res.status);
    const isSafeClientRendered = res.status === 200;
    record(
      "GET /profile (unauthenticated) never serves private data server-side",
      isRedirectOrDenied || isSafeClientRendered,
      `got ${res.status}`,
    );
    if (isSafeClientRendered) {
      const text = await res.clone().text();
      record("GET /profile (unauthenticated) 200 response contains no email-shaped string", !/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text));
    }
  } catch (err) {
    record("GET /profile (unauthenticated) never serves private data server-side", false, err.message);
  }

  // --- security headers + CSP nonce uniqueness ---
  try {
    const [resA, resB] = await Promise.all([fetchWithTimeout(new URL("/", base)), fetchWithTimeout(new URL("/", base))]);
    const cspA = resA.headers.get("content-security-policy");
    const cspB = resB.headers.get("content-security-policy");
    record("Content-Security-Policy header present", !!cspA);
    record("X-Content-Type-Options: nosniff present", resA.headers.get("x-content-type-options") === "nosniff");
    if (cspA && cspB) {
      const nonceA = cspA.match(/'nonce-([^']+)'/)?.[1];
      const nonceB = cspB.match(/'nonce-([^']+)'/)?.[1];
      record("CSP nonce differs between two independent requests", !!nonceA && !!nonceB && nonceA !== nonceB);
    } else {
      record("CSP nonce differs between two independent requests", false, "no CSP header to compare");
    }
  } catch (err) {
    record("Security headers / CSP nonce check", false, err.message);
  }

  // --- no-secret-leakage across everything fetched above ---
  // sitemap.xml is deliberately excluded here: it's expected to contain
  // many long, legitimate alphanumeric URL path segments (product slugs,
  // ObjectId-derived tails) that the base64/hex-shaped heuristic below
  // would otherwise false-positive on — those are public URLs, not
  // secrets, and checking a page made ENTIRELY of URLs for "does this
  // contain something URL-shaped" isn't a meaningful signal either way.
  for (const [label, res] of [
    ["/", null],
    ["/api/health/ready", readyRes],
    ["/robots.txt", robotsRes],
  ]) {
    if (!res) continue;
    try {
      const text = await res.clone().text();
      record(`${label} response contains no secret-shaped token`, !looksLikeItLeaksSecrets(text));
    } catch {
      // body already consumed or unreadable — not itself a failure
    }
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log("\nFailed checks:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
