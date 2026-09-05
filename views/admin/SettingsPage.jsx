"use client";

import { Children, cloneElement, useCallback, useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Save, Plus, Trash2, Gift, Image as ImageIcon, Upload, X } from "lucide-react";
import { useSettings } from "../../context/SettingsContext.jsx";
import { CSRF_COOKIE_NAME } from "../../lib/cookies.js";
import { isApprovedImageSource } from "../../lib/approvedImageSource.js";

const baseUrl = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}/api`
  : "/api";

// Phase 2: auth is the HttpOnly session cookie, sent automatically by
// `credentials: "include"` below — nothing to attach by hand anymore. The
// CSRF cookie is deliberately NOT HttpOnly (see lib/cookies.js), so it can
// be read here and echoed back as a header on unsafe (PUT/POST) requests —
// same pattern store/apiSlice.js uses for the rest of the app.
const csrfHeaders = () => {
  if (typeof document === "undefined") return {};
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]*)`));
  const token = match ? decodeURIComponent(match[1]) : null;
  return token ? { "X-CSRF-Token": token } : {};
};

// Upload a single image file via the existing /api/upload endpoint and
// return the resulting Cloudinary URL. We POST FormData so multer sees it —
// no Content-Type header, the browser sets the multipart boundary itself.
const uploadImage = async (file, folder = "branding") => {
  const fd = new FormData();
  fd.append("image", file);
  const res = await fetch(
    `${baseUrl}/upload?folder=${encodeURIComponent(folder)}`,
    {
      method: "POST",
      credentials: "include",
      headers: { ...csrfHeaders() },
      body: fd,
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.message || `Upload failed (${res.status})`);
  }
  return data.url;
};

const Section = ({ title, children, action }) => (
  <div className="rounded-lg border border-border bg-card p-6 mb-6">
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {action}
    </div>
    {children}
  </div>
);

// Phase 10 — the label previously had no `htmlFor`, and its single
// control child (Input/Select/etc. below) had no `id` — visually
// adjacent but programmatically unassociated. Every call site renders
// exactly one control as `children`, so cloning it to inject a
// useId()-generated `id` (only when the child doesn't already carry its
// own) links label and control everywhere Field is used, with zero
// changes needed at each of this file's ~20+ call sites.
const Field = ({ label, children, help }) => {
  const generatedId = useId();
  const child = Children.only(children);
  const controlId = child.props?.id || generatedId;
  return (
    <div className="mb-4">
      <label htmlFor={controlId} className="block text-sm font-medium mb-1">{label}</label>
      {cloneElement(child, { id: controlId })}
      {help && <p className="text-xs text-muted-foreground mt-1">{help}</p>}
    </div>
  );
};

const Input = (props) => (
  <input
    {...props}
    className="w-full rounded border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
  />
);

const Select = (props) => (
  <select
    {...props}
    className="w-full rounded border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
  />
);

const Toggle = ({ checked, onChange, label, help }) => (
  <label className="flex items-start gap-3 cursor-pointer">
    <input
      type="checkbox"
      checked={!!checked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-1 h-4 w-4 rounded border-border accent-primary"
    />
    <div>
      <span className="text-sm font-medium">{label}</span>
      {help && <p className="text-xs text-muted-foreground mt-0.5">{help}</p>}
    </div>
  </label>
);

/**
 * Reusable image picker. Shows a preview of the current URL, lets the
 * admin paste a URL OR upload a file. The "uploading" state is local so
 * each picker spins independently when fired in parallel.
 */
const ImagePicker = ({ value, onChange, label, help, accept = "image/*" }) => {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file, "branding");
      onChange(url);
      toast.success(`${label} uploaded`);
    } catch (err) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
      // Reset so the same file can be re-picked if needed
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Field label={label} help={help}>
      <div className="flex items-start gap-3">
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-background">
          {value && isApprovedImageSource(value) ? (
            <Image
              src={value}
              alt={label}
              fill
              sizes="64px"
              className="object-contain"
            />
          ) : value ? (
            // `value` is a free-text branding URL (see the text input
            // right below — placeholder "https://… (or upload)") that an
            // admin can paste directly, not only a Cloudinary URL from
            // the upload button. An unapproved host isn't just ineligible
            // for next/image — proxy.js's production CSP `img-src`
            // ('self' https://res.cloudinary.com data: blob:) already
            // blocks the browser from ever loading it directly, so a raw
            // <img> here would silently fail in production anyway. The
            // icon fallback below is what actually renders for that case.
            <ImageIcon className="h-6 w-6 text-muted-foreground" />
          ) : (
            <ImageIcon className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 space-y-2">
          <Input
            type="text"
            placeholder="https://… (or upload)"
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              onChange={handleFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
            >
              <Upload size={12} />
              {uploading ? "Uploading…" : "Upload"}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange("")}
                className="inline-flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
              >
                <X size={12} /> Clear
              </button>
            )}
          </div>
        </div>
      </div>
    </Field>
  );
};

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const { refresh: refreshPublicSettings } = useSettings();

  const loadSettings = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`${baseUrl}/settings`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) {
        throw new Error(d.message || `Failed to load settings (${res.status})`);
      }
      setSettings(d.settings);
    } catch (err) {
      const msg = err.message || "Failed to load settings";
      setLoadError(msg);
      toast.error(msg);
    }
  }, []);

  useEffect(() => {
    // loadSettings() is also wired directly to the retry button's onClick
    // (a real event handler, where a synchronous setState is fine) — its
    // first line resets `loadError`. Deferred with setTimeout(...,0) here,
    // matching the same pattern already used in CheckoutPage.jsx's debounced
    // preview effect, so the reset isn't a synchronous setState directly in
    // this effect's body. loadSettings itself is untouched, so the retry
    // button's behavior is unaffected.
    const timer = setTimeout(() => loadSettings(), 0);
    return () => clearTimeout(timer);
  }, [loadSettings]);

  if (!settings) {
    return (
      <div className="p-6 max-w-lg">
        {loadError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
            <h2 className="text-lg font-semibold text-destructive">
              Couldn’t load settings
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
            <button
              onClick={loadSettings}
              className="mt-4 inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Loading…</div>
        )}
      </div>
    );
  }

  const update = (path, value) => {
    setSettings((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const keys = path.split(".");
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) {
        if (cur[keys[i]] === undefined) cur[keys[i]] = {};
        cur = cur[keys[i]];
      }
      cur[keys[keys.length - 1]] = value;
      return next;
    });
  };

  const updateTaxRule = (region, field, value) => {
    setSettings((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const rule = next.taxRules.find((r) => r.region === region);
      if (rule) rule[field] = value;
      return next;
    });
  };

  const updateZoneTier = (region, idx, field, value) => {
    setSettings((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const zone = next.shippingZones.find((z) => z.region === region);
      if (zone && zone.tiers[idx]) zone.tiers[idx][field] = value;
      return next;
    });
  };

  const addTier = (region) => {
    setSettings((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const zone = next.shippingZones.find((z) => z.region === region);
      if (zone) {
        zone.tiers.push({ name: "New Tier", baseCost: 0, freeAbove: 0 });
      }
      return next;
    });
  };

  const removeTier = (region, idx) => {
    setSettings((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const zone = next.shippingZones.find((z) => z.region === region);
      if (zone) zone.tiers.splice(idx, 1);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`${baseUrl}/settings`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...csrfHeaders(),
        },
        body: JSON.stringify({
          store: settings.store,
          currency: settings.currency,
          promotions: settings.promotions,
          taxRules: settings.taxRules,
          shippingZones: settings.shippingZones,
          exchangePolicy: settings.exchangePolicy,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.success) {
        toast.success("Settings saved");
        setSettings(d.settings);
        // Re-fetch /settings/public so this admin's open tabs (header,
        // footer, favicon) update immediately. Other browsers will pick
        // up the change within the SettingsContext cache TTL (5 min).
        refreshPublicSettings?.();
      } else {
        toast.error(d.message || `Save failed (${r.status})`);
      }
    } catch (e) {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Store Settings</h1>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <Save size={16} />
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      <Section title="Store info">
        <Field
          label="Store name"
          help="Shown in the header, footer, and browser tab title."
        >
          <Input
            value={settings.store.name}
            onChange={(e) => update("store.name", e.target.value)}
          />
        </Field>
        <Field label="Support email">
          <Input
            type="email"
            value={settings.store.supportEmail}
            onChange={(e) => update("store.supportEmail", e.target.value)}
          />
        </Field>
        <Field label="Support phone">
          <Input
            value={settings.store.supportPhone}
            onChange={(e) => update("store.supportPhone", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Branding">
        <ImagePicker
          label="Logo"
          help="Shown in the site header. Recommended ~200×60px PNG/SVG."
          value={settings.store.logoUrl}
          onChange={(v) => update("store.logoUrl", v)}
        />
        <ImagePicker
          label="Logo (dark mode)"
          help="Optional. Used when the site is in dark mode. Falls back to the regular logo if blank."
          value={settings.store.logoDarkUrl}
          onChange={(v) => update("store.logoDarkUrl", v)}
        />
        <ImagePicker
          label="Favicon"
          help="Shown in browser tabs and bookmarks. Recommended 32×32 or 64×64 PNG/ICO."
          value={settings.store.faviconUrl}
          onChange={(v) => update("store.faviconUrl", v)}
          accept="image/png,image/x-icon,image/svg+xml,image/jpeg,image/webp"
        />
      </Section>

      <Section title="Currency">
        <Field
          label="Default display currency"
          help="What customers see before they pick a region at checkout."
        >
          <Select
            value={settings.currency.defaultDisplay}
            onChange={(e) => update("currency.defaultDisplay", e.target.value)}
          >
            <option value="BDT">BDT (৳)</option>
            <option value="USD">USD ($)</option>
          </Select>
        </Field>
        <Field
          label="Exchange rate (1 USD = X BDT)"
          help="Product prices are stored in USD. This rate converts to BDT for BD customers."
        >
          <Input
            type="number"
            step="0.01"
            value={settings.currency.usdToBdt}
            onChange={(e) =>
              update("currency.usdToBdt", Number(e.target.value) || 0)
            }
          />
        </Field>
      </Section>

      <Section
        title={
          <span className="inline-flex items-center gap-2">
            <Gift className="h-4 w-4" />
            Promotions
          </span>
        }
      >
        <Toggle
          checked={settings.promotions?.firstOrderFreeShipping}
          onChange={(v) => update("promotions.firstOrderFreeShipping", v)}
          label="Free shipping on first order"
          help="When a customer places their very first order, shipping is automatically waived. Once used, the benefit cannot be reclaimed (even by cancelling and reordering)."
        />
      </Section>

      <Section title="Exchange policy">
        <Field
          label="Exchange window (days)"
          help="Shown across the storefront (header, homepage, product pages) as '<N>-day exchange'."
        >
          <Input
            type="number"
            min="0"
            value={settings.exchangePolicy?.windowDays ?? 14}
            onChange={(e) => update("exchangePolicy.windowDays", Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="Short description" help='e.g. "Easy exchanges" or "Size or color swap, free"'>
          <Input
            value={settings.exchangePolicy?.description ?? ""}
            onChange={(e) => update("exchangePolicy.description", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Tax rules">
        {settings.taxRules.map((rule) => (
          <div
            key={rule.region}
            className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end mb-4 p-3 rounded border border-border"
          >
            <Field label="Region">
              <Input value={rule.region} disabled />
            </Field>
            <Field label="Label">
              <Input
                value={rule.label}
                onChange={(e) =>
                  updateTaxRule(rule.region, "label", e.target.value)
                }
              />
            </Field>
            <Field label="Rate (e.g. 0.15 = 15%)">
              <Input
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={rule.rate}
                onChange={(e) =>
                  updateTaxRule(rule.region, "rate", Number(e.target.value))
                }
              />
            </Field>
            <Field label="Tax-inclusive pricing?">
              <Select
                value={rule.inclusive ? "yes" : "no"}
                onChange={(e) =>
                  updateTaxRule(rule.region, "inclusive", e.target.value === "yes")
                }
              >
                <option value="no">No (added at checkout)</option>
                <option value="yes">Yes (included in price)</option>
              </Select>
            </Field>
          </div>
        ))}
      </Section>

      {settings.shippingZones.map((zone) => (
        <Section
          key={zone.region}
          title={`Shipping — ${zone.region} (${zone.currency})`}
          action={
            <button
              onClick={() => addTier(zone.region)}
              className="inline-flex items-center gap-1 text-sm rounded border border-border px-3 py-1.5 hover:bg-accent"
            >
              <Plus size={14} /> Add tier
            </button>
          }
        >
          {zone.tiers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tiers configured. Add one to enable shipping for this region.
            </p>
          ) : (
            zone.tiers.map((tier, idx) => (
              <div
                key={idx}
                className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-3 items-end mb-3 p-3 rounded border border-border"
              >
                <Field label="Tier name">
                  <Input
                    value={tier.name}
                    onChange={(e) =>
                      updateZoneTier(zone.region, idx, "name", e.target.value)
                    }
                  />
                </Field>
                <Field label={`Base cost (${zone.currency})`}>
                  <Input
                    type="number"
                    min="0"
                    value={tier.baseCost}
                    onChange={(e) =>
                      updateZoneTier(
                        zone.region,
                        idx,
                        "baseCost",
                        Number(e.target.value) || 0,
                      )
                    }
                  />
                </Field>
                <Field
                  label={`Free above (${zone.currency})`}
                  help="0 = never free"
                >
                  <Input
                    type="number"
                    min="0"
                    value={tier.freeAbove}
                    onChange={(e) =>
                      updateZoneTier(
                        zone.region,
                        idx,
                        "freeAbove",
                        Number(e.target.value) || 0,
                      )
                    }
                  />
                </Field>
                <button
                  onClick={() => removeTier(zone.region, idx)}
                  className="rounded border border-border p-2 text-destructive hover:bg-destructive/10"
                  title="Remove tier"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </Section>
      ))}
    </div>
  );
}
