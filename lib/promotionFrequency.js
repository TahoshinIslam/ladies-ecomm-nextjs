// Client-side popup frequency/eligibility state — CampaignPopup.jsx's own
// bookkeeping, never sent to or read by the server. Stores only the
// minimal, non-sensitive fields the admin-promotions feature spec requires:
// promotion id, promotion version, last-shown timestamp, dismissed
// timestamp. No PII, no user identity, no session token.
//
// Every accessor is wrapped in try/catch: a private browsing window, a
// user with site data blocked, or a full quota can all make
// localStorage/sessionStorage throw on read OR write. Failing means
// "treat this visitor as if nothing was ever recorded" — the popup may
// show more often than intended for that one visitor, which is a harmless
// UX repeat, not a correctness or security problem — never letting a
// storage failure break rendering or navigation.
const STORAGE_KEY = "tahos:promoState";
const SESSION_KEY_PREFIX = "tahos:promoShown:";

function readAllState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeState(id, patch) {
  try {
    const all = readAllState();
    all[id] = { ...all[id], ...patch };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable or full — see this file's top-of-file comment.
  }
}

function hasShownThisSession(id) {
  try {
    return window.sessionStorage.getItem(SESSION_KEY_PREFIX + id) === "1";
  } catch {
    return false;
  }
}

function markShownThisSession(id) {
  try {
    window.sessionStorage.setItem(SESSION_KEY_PREFIX + id, "1");
  } catch {
    // ignore
  }
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Whether `promotion` (the public DTO from GET /api/promotions/popup) is
 * currently eligible to be shown to THIS browser, per its own frequency
 * setting. Never called during SSR (CampaignPopup.jsx only calls this
 * client-side, after mount).
 *
 * A `version` change (an admin edited the campaign's creative/target —
 * see services/promotionService.js's own comment on what counts)
 * deliberately resets eligibility regardless of frequency: a visitor who
 * dismissed the OLD creative has not seen the new one.
 */
export function shouldShowPopup(promotion) {
  const state = readAllState()[promotion.id];
  if (state && state.version !== promotion.version) return true;

  switch (promotion.frequency) {
    case "every_session":
      return true;
    case "once_per_session":
      return !hasShownThisSession(promotion.id);
    case "once_per_campaign":
      return !state?.lastShownAt;
    case "custom_cooldown": {
      if (!state?.lastShownAt) return true;
      const hours = promotion.cooldownHours || 24;
      return Date.now() - state.lastShownAt >= hours * HOUR_MS;
    }
    case "once_per_day":
    default: {
      if (!state?.lastShownAt) return true;
      return Date.now() - state.lastShownAt >= 24 * HOUR_MS;
    }
  }
}

export function recordPopupShown(promotion) {
  markShownThisSession(promotion.id);
  writeState(promotion.id, { version: promotion.version, lastShownAt: Date.now() });
}

export function recordPopupDismissed(promotion) {
  writeState(promotion.id, { version: promotion.version, dismissedAt: Date.now() });
}
