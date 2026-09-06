// Phase 11, section F — validates that a set of environment variables is
// SHAPED correctly for a production deployment, without ever connecting to
// any real service (no Mongo connection, no SMTP connection, no Cloudinary
// API call) and without ever printing a secret value to stdout/stderr.
//
// This is a pure, static shape check: URL scheme/host patterns, string
// length/entropy heuristics, and cross-variable equality checks. It
// CANNOT and does not prove a credential is valid — only that it is not
// an obviously-wrong placeholder (localhost, "example", "changeme", a
// value copied from .env.test into production, etc).
//
// Usage:
//   node scripts/validateProductionEnv.mjs           (validates process.env)
//   npm run validate:production                       (same, via npm script)
//
// Exit code: 0 if every required variable is present and shaped safely;
// 1 otherwise, with a bulleted list of problems (names + reasons only,
// never values) printed to stderr.
//
// Deliberately NOT wired into `npm run build` or any pretest hook — an
// ordinary local/CI build must keep working with no real secrets set at
// all (see the tests below, which run this script's pure functions
// against synthetic fixtures, never against the real environment).

const PLACEHOLDER_PATTERNS = [
  /localhost/i,
  /127\.0\.0\.1/,
  /example\.(com|org|net)/i,
  /changeme/i,
  /placeholder/i,
  /your[-_]?(app|api|secret|key)/i,
  /xxx+/i,
  /^test$/i,
  /^dev$/i,
];

function looksLikePlaceholder(value) {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(value));
}

// A weak secret heuristic: short, or made of a single repeated character,
// or an obviously sequential/keyboard-walk string. Not a full entropy
// estimator — good enough to catch "aaaaaaaa" / "12345678" / "" without
// false-positiving on a genuine random token.
function looksWeak(value) {
  if (!value || value.length < 16) return true;
  if (/^(.)\1+$/.test(value)) return true;
  if (/^(0123456789|abcdefgh|qwertyui)/i.test(value)) return true;
  return false;
}

// CLOUDINARY_API_KEY is a non-secret identifier (Cloudinary's own docs:
// https://cloudinary.com/documentation/developer_onboarding_faq_find_credentials
// — "the API key ... may be exposed client-side", unlike the API secret,
// which must remain protected). It is commonly a 15-digit number today,
// but nothing here hardcodes that shape as a requirement — Cloudinary
// documents the key only as "the key," not a fixed digit count, and this
// validator must not fail a real key just because a future/different
// account format doesn't match today's common shape. So this checks only
// that the value is a real, present, well-formed identifier — not that it
// is "strong" (the generic looksWeak() length/entropy heuristic below is
// for actual secrets, and previously ran against this non-secret field by
// mistake, wrongly failing a real ~15-digit key).
function looksLikeControlChars(value) {
  return /[\x00-\x1f\x7f]/.test(value);
}

function looksLikeInvalidIdentifier(value) {
  if (!value || !value.trim()) return "must not be empty or whitespace-only";
  if (looksLikeControlChars(value)) return "must not contain control characters";
  if (looksLikePlaceholder(value)) return "looks like a placeholder value";
  return true;
}

function isHttpsUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

function isMongoUri(value) {
  return /^mongodb(\+srv)?:\/\//.test(value || "");
}

// A bare heuristic for "this URI can reach a transaction-capable
// topology" — a real check would require connecting (explicitly out of
// scope here, see the file header). mongodb+srv:// (Atlas) always
// resolves to a replica set; a plain mongodb:// URI must explicitly name
// `replicaSet=` to be transaction-capable, since a lone standalone mongod
// cannot run multi-document transactions at all — this mirrors
// scripts/ensureReplicaSetReadiness.mjs's own live check, just as a
// static shape signal rather than a real handshake.
function looksTransactionCapable(uri) {
  if (/^mongodb\+srv:\/\//.test(uri)) return true;
  return /[?&]replicaSet=/.test(uri);
}

// Every variable this app's runtime code actually reads in a way that
// matters for production correctness/security. Each entry's `check`
// receives the raw string value (already confirmed non-empty) and must
// return true (valid) or a string (the specific reason it's invalid).
const RULES = [
  {
    name: "MONGO_URI",
    check: (v) => {
      if (!isMongoUri(v)) return "must be a mongodb:// or mongodb+srv:// URI";
      if (looksLikePlaceholder(v)) return "looks like a localhost/placeholder URI, not a real production database";
      if (!looksTransactionCapable(v)) {
        return "does not look transaction-capable — a plain mongodb:// URI must include replicaSet=, or use mongodb+srv:// (Atlas); this app relies on multi-document transactions (order/payment creation, stock decrement, coupon claims) that a standalone mongod cannot run";
      }
      return true;
    },
  },
  {
    name: "APP_ORIGIN",
    check: (v) => {
      if (!isHttpsUrl(v)) return "must be an https:// URL (CSRF Origin validation requires an exact match against real browser traffic, which is always https in production)";
      if (looksLikePlaceholder(v)) return "looks like a localhost/example placeholder, not the real production origin";
      return true;
    },
  },
  {
    name: "CLIENT_URL",
    check: (v) => {
      if (!isHttpsUrl(v)) return "must be an https:// URL (used to build absolute links in password-reset emails and SEO metadata)";
      if (looksLikePlaceholder(v)) return "looks like a localhost/example placeholder, not the real production origin";
      return true;
    },
  },
  {
    name: "CLOUDINARY_CLOUD_NAME",
    check: (v) => (looksLikePlaceholder(v) ? "looks like a placeholder value" : true),
  },
  { name: "CLOUDINARY_API_KEY", check: (v) => looksLikeInvalidIdentifier(v) },
  { name: "CLOUDINARY_API_SECRET", check: (v) => (looksWeak(v) ? "looks too short/weak to be a real API secret" : true) },
  {
    name: "SMTP_HOST",
    check: (v) => (looksLikePlaceholder(v) ? "looks like a localhost/placeholder SMTP host" : true),
  },
  { name: "SMTP_PORT", check: (v) => (/^\d+$/.test(v) ? true : "must be numeric") },
  { name: "SMTP_USER", check: (v) => (looksLikePlaceholder(v) ? "looks like a placeholder value" : true) },
  { name: "SMTP_PASS", check: (v) => (looksWeak(v) ? "looks too short/weak to be a real SMTP password" : true) },
];

// Cross-variable checks that need more than one value at once.
function crossChecks(env) {
  const problems = [];
  if (env.MONGO_URI && env.MONGO_URI_TEST && env.MONGO_URI === env.MONGO_URI_TEST) {
    problems.push("MONGO_URI and MONGO_URI_TEST must never be equal — a production deployment must never point at the same database as the automated test suite (which wipes/reseeds its database on every run)");
  }
  if (env.APP_ORIGIN && env.CLIENT_URL && env.APP_ORIGIN !== env.CLIENT_URL) {
    problems.push("APP_ORIGIN and CLIENT_URL should be the exact same origin in production — CSRF Origin validation (APP_ORIGIN) and app-generated absolute links (CLIENT_URL) must agree, or a legitimate request could be rejected while links point elsewhere");
  }
  return problems;
}

export function validateProductionEnv(env) {
  const problems = [];
  for (const rule of RULES) {
    const raw = env[rule.name];
    if (!raw) {
      problems.push(`${rule.name}: is not set`);
      continue;
    }
    const result = rule.check(raw);
    if (result !== true) problems.push(`${rule.name}: ${result}`);
  }
  problems.push(...crossChecks(env));
  return problems;
}

// Only runs the CLI/validation path when executed directly (`node
// scripts/validateProductionEnv.mjs`), never on import — tests import
// `validateProductionEnv` above and call it against synthetic fixtures.
if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = validateProductionEnv(process.env);
  if (problems.length > 0) {
    console.error("Production environment validation FAILED:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("Production environment validation passed.");
  process.exit(0);
}
