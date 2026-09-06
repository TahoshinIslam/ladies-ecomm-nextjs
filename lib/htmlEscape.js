// Phase 5 — a small, dependency-free HTML-escaping utility. Used anywhere a
// user-controlled string (a name, an address field, a review title, ...) is
// interpolated into an HTML string built by hand (email templates today;
// anything else that builds raw HTML from a template literal in the
// future). Not a general-purpose sanitizer — it does not allow ANY markup
// through, it escapes everything, which is exactly right for a plain-text
// value (a person's name) that should never be interpreted as markup.
const ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// Safe to call on an already-escaped value — `&` is escaped to `&amp;`,
// which contains no other special character, so escaping twice never
// produces a broken double-escape of an unrelated character. Callers
// should still only call this once per raw value, at the point it's
// interpolated into HTML — not on values that never touch HTML at all
// (e.g. don't escape a name before storing it in the database, or before
// putting it in a JSON API response — only right before it becomes HTML).
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

// For interpolating into an HTML attribute value specifically (e.g.
// `alt="${escapeHtmlAttribute(name)}"`) — identical escaping today (the
// same five characters cover both the text-node and quoted-attribute
// contexts), kept as a separate name so call sites document their own
// context rather than all reading as interchangeable with escapeHtml.
export const escapeHtmlAttribute = escapeHtml;
