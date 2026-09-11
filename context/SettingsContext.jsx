"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { sessionCache } from "../lib/utils.js";
import { formatBdt, formatMoney, usdToBdt } from "../lib/currency.js";
import { useLocale } from "./LocaleProvider.jsx";

const SettingsContext = createContext(null);

const DEFAULTS = {
  // Empty strings (not "Store") so consumers using
  // `settings.store.name || theme.siteName` correctly fall through to the
  // theme-provided defaults during the brief window before the network
  // fetch lands.
  store: { name: "", logoUrl: "", logoDarkUrl: "", faviconUrl: "" },
  currency: { defaultDisplay: "BDT", usdToBdt: 120 },
  shippingZones: [],
};

const baseUrl = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}/api`
  : "/api";

const SETTINGS_CACHE_KEY = "ss:settings";
const SETTINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const getCachedSettings = () => {
  try {
    const raw = sessionCache.get(SETTINGS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > SETTINGS_CACHE_TTL) return null;
    return parsed.data;
  } catch {
    return null;
  }
};

const setCachedSettings = (data) => {
  try {
    sessionCache.set(
      SETTINGS_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), data }),
    );
  } catch {
    // ignore storage errors
  }
};

/**
 * Bust the settings cache. Called from the admin SettingsPage right after
 * a save so the admin sees the change immediately on their own site visit.
 * Other browsers will pick up the change within SETTINGS_CACHE_TTL.
 */
export const bustSettingsCache = () => {
  try {
    sessionCache.remove(SETTINGS_CACHE_KEY);
  } catch {
    // ignore
  }
};

// Apply branding side effects to the document.
//   - document.title from store.name
//   - <link rel="icon"> from store.faviconUrl
// Both are optional; we only update if a value is provided so we don't
// blow away a useful theme-derived default.
const applyBranding = (store) => {
  if (!store) return;
  if (store.name) document.title = store.name;
  if (store.faviconUrl) {
    let link = document.querySelector("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = store.faviconUrl;
  }
};

export const SettingsProvider = ({ children }) => {
  // Deliberately NOT read synchronously during render (a prior version did
  // `const cached = getCachedSettings()` right here): sessionStorage only
  // exists in the browser, so the server's render always saw `cached` as
  // null/DEFAULTS, but the client's very first render — including its
  // hydration pass, which MUST match the server's HTML exactly — could see
  // a real cached value from an earlier navigation in the same tab. That
  // mismatch (e.g. Header.jsx's free-shipping announcement item vs. the
  // exchange-policy one) is a genuine React hydration error, not cosmetic.
  // Starting both server and client from the same DEFAULTS, then applying
  // the cache from inside an effect (client-only, after hydration commits),
  // guarantees the first render is identical everywhere.
  const [settings, setSettings] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const { locale } = useLocale();

  // Fetch the public settings payload. Used both on initial mount and when
  // an admin saves changes (via the exposed `refresh()` below) so their own
  // tab picks up the change without a page reload.
  const fetchSettings = () =>
    fetch(`${baseUrl}/settings/public`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        // GET /api/settings/public (app/api/settings/public/route.js)
        // returns `{ settings }` directly — it has never wrapped that in a
        // `success` flag (confirmed by the HTTP integration tests reading
        // `res.json().settings` directly). Gating on `d.success` here meant
        // this branch never ran in production: every page silently fell
        // back to DEFAULTS (empty store name/support contact, no
        // shippingZones, no homepage carousel/banner/campaign) forever,
        // masked only by call sites' own `|| fallback` values.
        if (d.settings) {
          setSettings(d.settings);
          setCachedSettings(d.settings);
          return d.settings;
        }
      })
      .catch(() => {
        // Stay with whatever we have (cache or defaults).
      });

  useEffect(() => {
    // Runs once, after the first (hydration-safe, DEFAULTS-based) render
    // commits. A cached value applies immediately and skips the network
    // round-trip; otherwise fetch for real. The synchronous setState here
    // is the deliberate point of this effect — syncing React state with
    // sessionStorage, a browser-only external system unavailable during
    // the render that has to match SSR — not an accidental one the lint
    // rule's "do you need this effect?" guidance is meant to catch.
    const cached = getCachedSettings();
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettings(cached);
      setLoaded(true);
      return;
    }
    fetchSettings().finally(() => setLoaded(true));
  }, []);

  // Apply branding to <head> whenever settings change. Runs after both the
  // initial cached render and any subsequent fetch. Safe to run on every
  // settings update — DOM ops are idempotent.
  useEffect(() => {
    applyBranding(settings.store);
  }, [settings.store?.name, settings.store?.faviconUrl]);

  const rate = settings.currency?.usdToBdt;

  // The free-shipping threshold, as a raw Taka number — or null if the
  // admin hasn't configured one. Prefers the Bangladesh zone (this
  // storefront is BDT-only and BD-shipping-only); an INTL zone's threshold
  // (see models/settingsModel.js — real, admin-configurable, but never
  // customer-facing as $) is converted to Taka right here, so every caller
  // downstream always receives a plain BDT number and can never
  // accidentally treat a raw USD amount as if it were already Taka. The
  // real Settings model nests freeAbove inside each zone's tiers[] (e.g.
  // "Inside Dhaka" vs "Outside Dhaka" can differ), so this picks the
  // lowest threshold among a zone's tiers as the headline number — the
  // easiest one to actually hit. Single source of truth for both
  // freeShippingThreshold() (raw, for cart math) and freeShippingPitch()
  // (formatted, for display) below, so the cart's progress bar and every
  // other page's free-shipping copy can never drift apart from the real,
  // admin-configured value.
  //
  // Plain closures (not `this`-based methods) so these stay callable after
  // being destructured off the context value — e.g.
  // `const { freeShippingPitch } = useSettings()` — without losing their
  // binding the way `freeShippingPitch() { this.freeShippingThreshold() }`
  // would.
  const freeShippingThreshold = useCallback(() => {
    const zones = settings.shippingZones || [];
    const thresholdFor = (zone) => {
      const withThreshold = (zone.tiers || []).filter((t) => t.freeAbove > 0);
      if (!withThreshold.length) return null;
      return Math.min(...withThreshold.map((t) => t.freeAbove));
    };
    const zone =
      zones.find((z) => z.currency === "BDT" && thresholdFor(z)) ||
      zones.find((z) => thresholdFor(z));
    const amount = zone && thresholdFor(zone);
    if (!zone || !amount) return null;
    return { amount: zone.currency === "USD" ? usdToBdt(amount, rate) : amount };
  }, [settings.shippingZones, rate]);

  // Formatted free-shipping pitch, e.g. "৳২,০০০".
  const freeShippingPitch = useCallback(() => {
    const threshold = freeShippingThreshold();
    if (!threshold) return null;
    return formatBdt(threshold.amount, locale);
  }, [freeShippingThreshold, locale]);

  const value = useMemo(
    () => ({
      ...settings,
      loaded,
      // Re-fetch /settings/public after an admin save so the open tab sees
      // the change without a full reload.
      refresh: () => {
        bustSettingsCache();
        return fetchSettings();
      },
      /**
       * Format a raw, USD-denominated catalog price (Product.basePrice,
       * variant.price, etc.) as Taka in the current UI language.
       */
      formatPrice: (rawUsdValue) => formatMoney(rawUsdValue, locale, rate),
      /**
       * Convert a raw USD-denominated catalog price to a Taka number (not
       * formatted) — the same conversion formatPrice() applies, exposed
       * separately so callers doing math (cart subtotal vs. free-shipping
       * threshold, etc.) stay in Taka throughout instead of comparing a raw
       * USD number against a BDT threshold.
       */
      toBdt: (rawUsdValue) => usdToBdt(rawUsdValue, rate),
      /**
       * Format a value that's already in Taka (e.g. the output of toBdt(),
       * or an order/checkout total from the API — those are pre-converted
       * server-side, see orderService.js's toRegionCurrency) — unlike
       * formatPrice(), this applies no conversion. Running an
       * already-converted value back through the exchange rate would be a
       * real double-conversion bug, not a display nuance.
       */
      formatBdt: (alreadyBdtValue) => formatBdt(alreadyBdtValue, locale),
      freeShippingThreshold,
      freeShippingPitch,
    }),
    [settings, loaded, locale, rate, freeShippingThreshold, freeShippingPitch],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    return {
      ...DEFAULTS,
      loaded: false,
      refresh: async () => {},
      formatPrice: (v) => formatMoney(v, "bn-BD", DEFAULTS.currency.usdToBdt),
      toBdt: (v) => usdToBdt(v, DEFAULTS.currency.usdToBdt),
      formatBdt: (v) => formatBdt(v, "bn-BD"),
      freeShippingThreshold: () => null,
      freeShippingPitch: () => null,
    };
  }
  return ctx;
};
