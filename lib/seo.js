// Phase 10 — shared SEO helpers: absolute-URL construction and safe
// JSON-LD serialization. Deliberately separate from lib/appUrl.js: that
// module's resolveAppOrigin() throws (HttpError 500) on a misconfigured
// CLIENT_URL, which is the right behavior for a password-reset email link
// (a broken/guessable link is a real security concern) but would be the
// wrong behavior here — a missing CLIENT_URL in dev/test/an unconfigured
// deployment must degrade to relative URLs, never take down every page's
// metadata resolution.
import { resolveAppOrigin } from "./appUrl.js";

// Never throws. Returns null when CLIENT_URL isn't configured/valid —
// callers fall back to relative URLs (still correct for on-site
// navigation and same-origin metadata; only cross-site consumers like a
// social-media unfurler lose full canonicalization until CLIENT_URL is
// set).
export function getSiteOrigin() {
  try {
    return resolveAppOrigin();
  } catch {
    return null;
  }
}

// Absolute URL under the app's own origin when one is configured, else a
// plain relative path (still valid for `alternates.canonical` and
// `openGraph.url` — Next resolves a relative canonical against
// `metadataBase` when that's set, and simply leaves it relative
// otherwise).
export function absoluteUrl(path = "/") {
  const origin = getSiteOrigin();
  if (!origin) return path;
  return new URL(path, origin).toString();
}

// Bounds a free-text description to a search-engine-friendly length
// without cutting mid-word, and strips newlines (a raw product
// `description` can be a multi-paragraph, admin-authored block of text —
// never safe to emit verbatim into a <meta name="description">).
export function truncateDescription(text, maxLength = 160) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxLength)}…`;
}

// Safely serializes a value for an inline `<script type="application/ld+json">`
// tag. JSON.stringify alone is not enough: a raw "</script>" substring
// inside a JSON string value would close the script tag early (the HTML
// parser doesn't know it's "inside a string" from its point of view), and
// the Unicode LINE SEPARATOR / PARAGRAPH SEPARATOR code points are valid
// inside a JSON string but are illegal, unescaped, in JavaScript string
// literals — some parsing paths choke on them. Escaping `<` generally
// (not just "</script>") also blocks "<!--" and "<script" variants.
const LINE_SEPARATOR = " ";
const PARAGRAPH_SEPARATOR = " ";

export function safeJsonLd(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(LINE_SEPARATOR, "\\u2028")
    .replaceAll(PARAGRAPH_SEPARATOR, "\\u2029");
}
