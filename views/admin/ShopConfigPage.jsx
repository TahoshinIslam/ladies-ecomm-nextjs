"use client";

// A focused landing page for the everyday storefront-content tasks — shop
// name, hero carousel images, the promotional banner, and the campaign
// message — without making someone dig through the full Settings page's
// tax/shipping/currency fields to find them. Reads/writes the same
// Settings singleton (GET/PUT /api/settings) SettingsPage.jsx already
// uses; each save here sends the *whole* `store`/`homepage` object back
// (the API replaces those keys wholesale), merged from the last full
// load plus just the one field group being edited.
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Store, GalleryHorizontal, Image as ImageIcon, Megaphone, Upload, X, Loader2 } from "lucide-react";

import Button from "../../components/ui/Button.jsx";
import Input from "../../components/ui/Input.jsx";
import Textarea from "../../components/ui/Textarea.jsx";
import Modal from "../../components/ui/Modal.jsx";
import { useSettings } from "../../context/SettingsContext.jsx";
import { CSRF_COOKIE_NAME } from "../../lib/cookies.js";
import { isApprovedImageSource } from "../../lib/approvedImageSource.js";

const baseUrl = process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}/api` : "/api";

const csrfHeaders = () => {
  if (typeof document === "undefined") return {};
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]*)`));
  const token = match ? decodeURIComponent(match[1]) : null;
  return token ? { "X-CSRF-Token": token } : {};
};

const uploadImage = async (file, folder = "homepage") => {
  const fd = new FormData();
  fd.append("image", file);
  const res = await fetch(`${baseUrl}/upload?folder=${encodeURIComponent(folder)}`, {
    method: "POST",
    credentials: "include",
    headers: { ...csrfHeaders() },
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || `Upload failed (${res.status})`);
  return data.url;
};

const CONFIG_ITEMS = [
  { key: "shopName", title: "Shop Name", description: "Change the store's name.", icon: Store },
  { key: "carousel", title: "Carousel", description: "Set the hero carousel images.", icon: GalleryHorizontal },
  { key: "banner", title: "Banner", description: "Set the homepage promotional banner.", icon: ImageIcon },
  { key: "campaign", title: "Campaign", description: "Run an offer message for visitors.", icon: Megaphone },
];

export default function ShopConfigPage() {
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [openKey, setOpenKey] = useState(null);
  const { refresh: refreshPublicSettings } = useSettings();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`${baseUrl}/settings`, { credentials: "include", headers: { Accept: "application/json" } });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) throw new Error(d.message || `Failed to load settings (${res.status})`);
      setSettings(d.settings);
    } catch (err) {
      setLoadError(err.message || "Failed to load settings");
    }
  }, []);

  useEffect(() => {
    // Deferred to avoid a synchronous setState directly inside the effect
    // body — same pattern views/admin/SettingsPage.jsx already uses for
    // this exact load-on-mount case.
    const timer = setTimeout(() => load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const onSaved = async (patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    setOpenKey(null);
    await refreshPublicSettings?.();
  };

  if (!settings) {
    return (
      <div className="max-w-lg p-6">
        {loadError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
            <h2 className="text-lg font-semibold text-destructive">Couldn&apos;t load settings</h2>
            <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
            <Button onClick={load} className="mt-4">
              Retry
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Shop Config</h1>
        <p className="mt-1 text-sm text-muted-foreground">Shop name, carousel, banner, and campaign — the storefront&apos;s front page.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CONFIG_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setOpenKey(item.key)}
            className="flex flex-col items-start gap-3 rounded-xl border border-border bg-background p-5 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
          >
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
              <item.icon className="h-5 w-5" />
            </span>
            <div>
              <div className="font-semibold">{item.title}</div>
              <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
            </div>
          </button>
        ))}
      </div>

      {openKey === "shopName" && (
        <ShopNameModal store={settings.store} onClose={() => setOpenKey(null)} onSaved={onSaved} />
      )}
      {openKey === "carousel" && (
        <CarouselModal homepage={settings.homepage} onClose={() => setOpenKey(null)} onSaved={onSaved} />
      )}
      {openKey === "banner" && (
        <BannerModal homepage={settings.homepage} onClose={() => setOpenKey(null)} onSaved={onSaved} />
      )}
      {openKey === "campaign" && (
        <CampaignModal homepage={settings.homepage} onClose={() => setOpenKey(null)} onSaved={onSaved} />
      )}
    </div>
  );
}

async function saveSettings(body) {
  const res = await fetch(`${baseUrl}/settings`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || `Save failed (${res.status})`);
  return data.settings;
}

function ImagePickerField({ value, onChange, label }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      onChange(await uploadImage(file));
      toast.success(`${label} uploaded`);
    } catch (err) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      <div className="flex items-start gap-3">
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-background">
          {value && isApprovedImageSource(value) ? (
            <Image src={value} alt={label} fill sizes="64px" className="object-cover" />
          ) : (
            <ImageIcon className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 space-y-2">
          <Input placeholder="https://… (or upload)" value={value || ""} onChange={(e) => onChange(e.target.value)} />
          <div className="flex items-center gap-2">
            <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
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
    </div>
  );
}

function ShopNameModal({ store, onClose, onSaved }) {
  const [name, setName] = useState(store?.name || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Shop name is required");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveSettings({ store: { ...store, name: name.trim() } });
      toast.warning("Shop name updated");
      onSaved({ store: saved.store });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Shop Name" size="sm">
      <div className="space-y-4 p-5">
        <Input label="Shop name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CarouselModal({ homepage, onClose, onSaved }) {
  const existing = homepage?.carouselImages || {};
  const [images, setImages] = useState({ burqa: existing.burqa || "", abaya: existing.abaya || "", hijab: existing.hijab || "" });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveSettings({ homepage: { ...homepage, carouselImages: images } });
      toast.warning("Carousel updated");
      onSaved({ homepage: saved.homepage });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Carousel" size="md">
      <div className="space-y-4 p-5">
        <p className="text-xs text-muted-foreground">
          Overrides the home page hero image for that department. Leave blank to use the department&apos;s own top-rated product photo.
        </p>
        <ImagePickerField label="Burqa" value={images.burqa} onChange={(v) => setImages((s) => ({ ...s, burqa: v }))} />
        <ImagePickerField label="Abaya" value={images.abaya} onChange={(v) => setImages((s) => ({ ...s, abaya: v }))} />
        <ImagePickerField label="Hijab" value={images.hijab} onChange={(v) => setImages((s) => ({ ...s, hijab: v }))} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function BannerModal({ homepage, onClose, onSaved }) {
  const existing = homepage?.banner || {};
  const [enabled, setEnabled] = useState(!!existing.enabled);
  const [imageUrl, setImageUrl] = useState(existing.imageUrl || "");
  const [href, setHref] = useState(existing.href || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (enabled && !imageUrl.trim()) {
      toast.error("Add a banner image, or turn the banner off");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveSettings({ homepage: { ...homepage, banner: { enabled, imageUrl: imageUrl.trim(), href: href.trim() } } });
      toast.warning("Banner updated");
      onSaved({ homepage: saved.homepage });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Banner" size="md">
      <div className="space-y-4 p-5">
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-border accent-primary"
          />
          <div>
            <span className="text-sm font-medium">Show banner on the home page</span>
            <p className="mt-0.5 text-xs text-muted-foreground">Off by default — nothing shows until enabled with an image.</p>
          </div>
        </label>
        <ImagePickerField label="Banner image" value={imageUrl} onChange={setImageUrl} />
        <Input label="Link (optional)" placeholder="/shop?collection=discount" value={href} onChange={(e) => setHref(e.target.value)} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CampaignModal({ homepage, onClose, onSaved }) {
  const existing = homepage?.campaign || {};
  const [enabled, setEnabled] = useState(!!existing.enabled);
  const [title, setTitle] = useState(existing.title || "");
  const [message, setMessage] = useState(existing.message || "");
  const [ctaLabel, setCtaLabel] = useState(existing.ctaLabel || "");
  const [ctaHref, setCtaHref] = useState(existing.ctaHref || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (enabled && !title.trim() && !message.trim()) {
      toast.error("Add a title or a message, or turn the campaign off");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveSettings({
        homepage: {
          ...homepage,
          campaign: { enabled, title: title.trim(), message: message.trim(), ctaLabel: ctaLabel.trim(), ctaHref: ctaHref.trim() },
        },
      });
      toast.warning("Campaign updated");
      onSaved({ homepage: saved.homepage });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Campaign" size="md">
      <div className="space-y-4 p-5">
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-border accent-primary"
          />
          <div>
            <span className="text-sm font-medium">Run this campaign on the home page</span>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Off by default — the home page&apos;s regular copy shows until this is turned on.
            </p>
          </div>
        </label>
        <Input label="Title" placeholder="e.g. Eid Collection — 20% off" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea label="Message" placeholder="What&apos;s the offer?" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Button label" placeholder="Shop the offer" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} />
          <Input label="Button link" placeholder="/shop?collection=discount" value={ctaHref} onChange={(e) => setCtaHref(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
