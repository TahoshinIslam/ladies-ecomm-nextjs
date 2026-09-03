"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { sessionCache, storage } from "../lib/utils.js";

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

const STORAGE_KEY = "ss:currency";
const SETTINGS_CACHE_KEY = "ss:settings";
const SETTINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Decide which currency to show:
 * 1. Manual user override (localStorage) — wins.
 * 2. Browser locale — bn/bn-BD/etc → BDT, else USD.
 * 3. Server default fallback.
 */
const detectCurrency = (serverDefault) => {
  if (typeof window === "undefined") return serverDefault;
  const stored = storage.get(STORAGE_KEY);
  if (stored === "BDT" || stored === "USD") return stored;

  const lang = (navigator.language || "").toLowerCase();
  if (lang.startsWith("bn") || lang.includes("-bd")) return "BDT";
  return "USD";
};

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
  const cached = getCachedSettings();
  const [settings, setSettings] = useState(cached || DEFAULTS);
  const [loaded, setLoaded] = useState(!!cached);
  const [activeCurrency, setActiveCurrencyState] = useState(
    detectCurrency(cached?.currency?.defaultDisplay || "USD"),
  );

  // Fetch the public settings payload. Used both on initial mount and when
  // an admin saves changes (via the exposed `refresh()` below) so their own
  // tab picks up the change without a page reload.
  const fetchSettings = () =>
    fetch(`${baseUrl}/settings/public`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setSettings(d.settings);
          setCachedSettings(d.settings);
          setActiveCurrencyState((cur) =>
            // Don't override an explicit user pick when the server default changes.
            storage.get(STORAGE_KEY) ? cur : detectCurrency(d.settings.currency.defaultDisplay),
          );
          return d.settings;
        }
      })
      .catch(() => {
        // Stay with whatever we have (cache or defaults).
      });

  useEffect(() => {
    // Skip network fetch if we have valid cached settings
    if (cached) {
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

  const setActiveCurrency = (currency) => {
    if (currency !== "BDT" && currency !== "USD") return;
    storage.set(STORAGE_KEY, currency);
    setActiveCurrencyState(currency);
  };

  const value = useMemo(
    () => ({
      ...settings,
      loaded,
      activeCurrency,
      setActiveCurrency,
      // Re-fetch /settings/public after an admin save so the open tab sees
      // the change without a full reload.
      refresh: () => {
        bustSettingsCache();
        return fetchSettings();
      },
      /**
       * Format a USD-priced product into the active display currency.
       */
      formatPrice: (usdPrice) => {
        const cur = activeCurrency;
        const value =
          cur === "BDT"
            ? Math.round(Number(usdPrice) * settings.currency.usdToBdt)
            : Number(usdPrice);
        try {
          return new Intl.NumberFormat(cur === "BDT" ? "en-BD" : "en-US", {
            style: "currency",
            currency: cur,
            maximumFractionDigits: 0,
          }).format(value || 0);
        } catch {
          return `${cur} ${value}`;
        }
      },
      /**
       * Find the free-shipping threshold for the customer's display currency.
       * Returns a pre-formatted string like "$200" or "৳2,000", or null if
       * the admin hasn't configured one.
       */
      freeShippingPitch: () => {
        const zones = settings.shippingZones || [];
        // Match by the customer's active display currency (BDT viewers see
        // the BD threshold, USD viewers see the INTL threshold). Falls back
        // to the first zone with a configured threshold.
        const zone =
          zones.find((z) => z.currency === activeCurrency && z.freeAbove) ||
          zones.find((z) => z.freeAbove);
        if (!zone || !zone.freeAbove) return null;
        try {
          return new Intl.NumberFormat(zone.currency === "BDT" ? "en-BD" : "en-US", {
            style: "currency",
            currency: zone.currency,
            maximumFractionDigits: 0,
          }).format(zone.freeAbove);
        } catch {
          return `${zone.currency} ${zone.freeAbove}`;
        }
      },
    }),
    [settings, loaded, activeCurrency],
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
      activeCurrency: "USD",
      setActiveCurrency: () => {},
      refresh: async () => {},
      formatPrice: (v) =>
        new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(Number(v) || 0),
      freeShippingPitch: () => null,
    };
  }
  return ctx;
};
