"use client";

// A focused landing page for the everyday storefront-content tasks — shop
// name, hero carousel images, the promotional banner, and the campaign
// message — without making someone dig through the full Settings page's
// tax/shipping/currency fields to find them. Reads/writes the same
// Settings singleton (GET/PUT /api/settings) SettingsPage.jsx already
// uses; each save here sends the *whole* `store`/`homepage` object back
// (the API replaces those keys wholesale), merged from the last full
// load plus just the one field group being edited.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Store,
  GalleryHorizontal,
  Image as ImageIcon,
  Megaphone,
  LayoutGrid,
  Shirt,
  CalendarHeart,
  Compass,
  Menu,
} from "lucide-react";

import Button from "../../components/ui/Button.jsx";
import Input from "../../components/ui/Input.jsx";
import Textarea from "../../components/ui/Textarea.jsx";
import Modal from "../../components/ui/Modal.jsx";
import Skeleton from "../../components/ui/Skeleton.jsx";
import ImageDropzone from "../../components/admin/ImageDropzone.jsx";
import FramedImageInput from "../../components/admin/imageFraming/FramedImageInput.jsx";
import { homepageFramingKey } from "../../lib/imageFraming.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import { usePermission } from "../../hooks/usePermission.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { CSRF_COOKIE_NAME } from "../../lib/cookies.js";

const baseUrl = process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}/api` : "/api";

const csrfHeaders = () => {
  if (typeof document === "undefined") return {};
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]*)`));
  const token = match ? decodeURIComponent(match[1]) : null;
  return token ? { "X-CSRF-Token": token } : {};
};

const CONFIG_ITEMS = [
  { key: "shopName", title: "Shop Name", description: "Change the store's name.", icon: Store },
  { key: "carousel", title: "Carousel", description: "Set and frame the hero carousel images.", icon: GalleryHorizontal },
  { key: "departments", title: "Departments", description: "Set each department card's photo.", icon: LayoutGrid },
  { key: "fabrics", title: "Fabric Story", description: "Set each fabric card's photo.", icon: Shirt },
  { key: "occasions", title: "Occasions", description: "Set each occasion card's photo.", icon: CalendarHeart },
  { key: "guidedFinder", title: "Guided Discovery", description: "Set the \"Not sure where to start?\" panel photo.", icon: Compass },
  { key: "occasionMenu", title: "Occasions Menu", description: "Set the header's Occasions dropdown photo.", icon: Menu },
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
    if (loadError) {
      return (
        <div className="max-w-lg p-6">
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
            <h2 className="text-lg font-semibold text-destructive">Couldn&apos;t load settings</h2>
            <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
            <Button onClick={load} className="mt-4">
              Retry
            </Button>
          </div>
        </div>
      );
    }
    // Mirrors the real page below (a heading plus a grid of CONFIG_ITEMS
    // cards) — same Skeleton language the rest of the admin already uses,
    // instead of this page's own one-off spinner+text.
    return (
      <div className="space-y-6 p-6">
        <div>
          <Skeleton className="h-7 w-40" />
          <Skeleton className="mt-2 h-4 w-96 max-w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CONFIG_ITEMS.map((item) => (
            <Skeleton key={item.key} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Shop Config</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Shop name, carousel, department/fabric/occasion photos, banner, and campaign — the storefront&apos;s front page.
        </p>
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
      {openKey === "departments" && (
        <DepartmentsModal homepage={settings.homepage} onClose={() => setOpenKey(null)} onSaved={onSaved} />
      )}
      {openKey === "fabrics" && (
        <FabricsModal homepage={settings.homepage} onClose={() => setOpenKey(null)} onSaved={onSaved} />
      )}
      {openKey === "occasions" && (
        <OccasionsModal homepage={settings.homepage} onClose={() => setOpenKey(null)} onSaved={onSaved} />
      )}
      {openKey === "guidedFinder" && (
        <GuidedFinderModal homepage={settings.homepage} onClose={() => setOpenKey(null)} onSaved={onSaved} />
      )}
      {openKey === "occasionMenu" && (
        <OccasionMenuModal homepage={settings.homepage} onClose={() => setOpenKey(null)} onSaved={onSaved} />
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

// Thin wrapper keeping the same {label, value, onChange} call signature
// every modal below already uses, backed by the shared drag-and-drop
// ImageDropzone (single-image mode) instead of a click-only <input
// type="file"> + paste-a-URL text box — the same widget
// ProductFormModal.jsx's product-photo fields already use, so every image
// field in the admin now behaves the same way (drag-and-drop, upload
// progress, one clear "Replace image" affordance) instead of this one
// corner of the admin being the one place without it.
function ImagePickerField({ value, onChange, label, folder = "homepage" }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      <ImageDropzone value={value || ""} onChange={onChange} folder={folder} multiple={false} />
    </div>
  );
}

// Homepage crop/fit records live in homepage.imageFraming, keyed
// "<placement>" or "<placement>:<slug>" with "." written "_" (see
// homepageFramingKey in lib/imageFraming.js). This is
// the framed counterpart of ImagePickerField: same drag-and-drop upload
// (through the shared FramedImageInput), plus guidance, exact-frame previews
// and the framing editor for every destination the image is shown in.
const framingKey = homepageFramingKey;

function FramedPickerField({ label, image, onImage, placements, slug, framingMap, onFramingMap, folder = "homepage" }) {
  const framings = Object.fromEntries(placements.map((k) => [k, framingMap[framingKey(k, slug)] ?? null]));
  return (
    <div>
      <FramedImageInput
        label={label}
        placements={placements}
        folder={folder}
        url={image || ""}
        framings={framings}
        onChange={({ url, framings: next }) => {
          onImage(url);
          onFramingMap((prev) => {
            const map = { ...prev };
            for (const k of placements) {
              if (next[k]) map[framingKey(k, slug)] = next[k];
              else delete map[framingKey(k, slug)];
            }
            return map;
          });
        }}
      />
    </div>
  );
}

const DEPARTMENT_PLACEMENTS = ["department.tile", "department.card"];

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

// One image per department slot, framed for BOTH hero shapes it appears in
// (desktop wide banner, phone ~square). Slides beyond these four departments
// — any number, each with its own link, schedule and crops — are created in
// Promotions → Carousel Banners; while any of those is live it replaces this
// department rotation on the storefront.
const CAROUSEL_SLOTS = [
  { slug: "burqa", label: "Burqa" },
  { slug: "abaya", label: "Abaya" },
  { slug: "hijab", label: "Hijab" },
  { slug: "khimar", label: "Khimar" },
];
const HERO_PLACEMENTS = ["hero.desktop", "hero.mobile"];

function CarouselModal({ homepage, onClose, onSaved }) {
  const can = usePermission();
  const existing = homepage?.carouselImages || {};
  const [images, setImages] = useState(Object.fromEntries(CAROUSEL_SLOTS.map(({ slug }) => [slug, existing[slug] || ""])));
  const [framing, setFraming] = useState(homepage?.imageFraming || {});
  const [saving, setSaving] = useState(false);
  const set = (key) => (v) => setImages((s) => ({ ...s, [key]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveSettings({ homepage: { ...homepage, carouselImages: images, imageFraming: framing } });
      toast.warning("Carousel updated");
      onSaved({ homepage: saved.homepage });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Carousel" size="lg">
      <div className="space-y-4 p-5">
        <p className="text-xs text-muted-foreground">
          Overrides the home page hero image for that department. Leave blank to use the department&apos;s own top-rated product photo.
          Use &quot;Adjust framing&quot; to choose exactly how each image is cropped on desktop and on phones.
        </p>
        {CAROUSEL_SLOTS.map(({ slug, label }) => (
          <FramedPickerField
            key={slug}
            label={label}
            image={images[slug]}
            onImage={set(slug)}
            slug={slug}
            placements={HERO_PLACEMENTS}
            framingMap={framing}
            onFramingMap={setFraming}
          />
        ))}
        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium text-ink">Need more than these four slides?</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Carousel Banners in Promotions has no slide limit: each slide gets its own desktop and mobile image, framing, link and schedule.
            While a banner is live it replaces the department slides above.
          </p>
          {can(PERMISSIONS.PROMOTIONS_MANAGE) ? (
            <Link
              href="/admin/promotions"
              onClick={onClose}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-ink hover:bg-muted focus-ring"
            >
              <GalleryHorizontal className="h-4 w-4" aria-hidden="true" /> Add more slides in Promotions
            </Link>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Ask an admin with Promotions access to add extra slides.</p>
          )}
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

function DepartmentsModal({ homepage, onClose, onSaved }) {
  const existing = homepage?.departmentImages || {};
  const [images, setImages] = useState({
    burqa: existing.burqa || "",
    abaya: existing.abaya || "",
    hijab: existing.hijab || "",
    niqab: existing.niqab || "",
    khimar: existing.khimar || "",
    "modest-sets": existing["modest-sets"] || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (key) => (v) => setImages((s) => ({ ...s, [key]: v }));
  const [framing, setFraming] = useState(homepage?.imageFraming || {});

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveSettings({ homepage: { ...homepage, departmentImages: images, imageFraming: framing } });
      toast.warning("Departments updated");
      onSaved({ homepage: saved.homepage });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Departments" size="lg">
      <div className="space-y-4 p-5">
        <p className="text-xs text-muted-foreground">
          The photo shown on each department&apos;s card in &quot;Shop by department.&quot; Burqa/Abaya/Khimar fall back to
          that department&apos;s own top-rated product photo when left blank; Hijab/Niqab/Modest Sets show a plain
          color card until a photo is set here.
        </p>
        <FramedPickerField label="Burqa" image={images["burqa"]} onImage={set("burqa")} slug="burqa" placements={DEPARTMENT_PLACEMENTS} framingMap={framing} onFramingMap={setFraming} />
        <FramedPickerField label="Abaya" image={images["abaya"]} onImage={set("abaya")} slug="abaya" placements={DEPARTMENT_PLACEMENTS} framingMap={framing} onFramingMap={setFraming} />
        <FramedPickerField label="Hijab" image={images["hijab"]} onImage={set("hijab")} slug="hijab" placements={DEPARTMENT_PLACEMENTS} framingMap={framing} onFramingMap={setFraming} />
        <FramedPickerField label="Niqab" image={images["niqab"]} onImage={set("niqab")} slug="niqab" placements={DEPARTMENT_PLACEMENTS} framingMap={framing} onFramingMap={setFraming} />
        <FramedPickerField label="Khimar" image={images["khimar"]} onImage={set("khimar")} slug="khimar" placements={DEPARTMENT_PLACEMENTS} framingMap={framing} onFramingMap={setFraming} />
        <FramedPickerField label="Modest Sets" image={images["modest-sets"]} onImage={set("modest-sets")} slug="modest-sets" placements={DEPARTMENT_PLACEMENTS} framingMap={framing} onFramingMap={setFraming} />
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

function FabricsModal({ homepage, onClose, onSaved }) {
  const existing = homepage?.fabricImages || {};
  const [images, setImages] = useState({
    nida: existing.nida || "",
    crepe: existing.crepe || "",
    chiffon: existing.chiffon || "",
    jersey: existing.jersey || "",
    georgette: existing.georgette || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (key) => (v) => setImages((s) => ({ ...s, [key]: v }));
  const [framing, setFraming] = useState(homepage?.imageFraming || {});

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveSettings({ homepage: { ...homepage, fabricImages: images, imageFraming: framing } });
      toast.warning("Fabric Story updated");
      onSaved({ homepage: saved.homepage });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Fabric Story" size="lg">
      <div className="space-y-4 p-5">
        <p className="text-xs text-muted-foreground">
          The photo shown on each fabric&apos;s card in &quot;What it&apos;s made of matters.&quot; Left blank keeps
          the existing plain placeholder.
        </p>
        <FramedPickerField label="Nida" image={images.nida} onImage={set("nida")} slug="nida" placements={["fabric.tile"]} framingMap={framing} onFramingMap={setFraming} />
        <FramedPickerField label="Crepe" image={images.crepe} onImage={set("crepe")} slug="crepe" placements={["fabric.tile"]} framingMap={framing} onFramingMap={setFraming} />
        <FramedPickerField label="Chiffon" image={images.chiffon} onImage={set("chiffon")} slug="chiffon" placements={["fabric.tile"]} framingMap={framing} onFramingMap={setFraming} />
        <FramedPickerField label="Jersey" image={images.jersey} onImage={set("jersey")} slug="jersey" placements={["fabric.tile"]} framingMap={framing} onFramingMap={setFraming} />
        <FramedPickerField label="Georgette" image={images.georgette} onImage={set("georgette")} slug="georgette" placements={["fabric.tile"]} framingMap={framing} onFramingMap={setFraming} />
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

function OccasionsModal({ homepage, onClose, onSaved }) {
  const existing = homepage?.occasionImages || {};
  const [images, setImages] = useState({
    eid: existing.eid || "",
    everyday: existing.everyday || "",
    bridal: existing.bridal || "",
    prayer: existing.prayer || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (key) => (v) => setImages((s) => ({ ...s, [key]: v }));
  const [framing, setFraming] = useState(homepage?.imageFraming || {});

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveSettings({ homepage: { ...homepage, occasionImages: images, imageFraming: framing } });
      toast.warning("Occasions updated");
      onSaved({ homepage: saved.homepage });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Occasions" size="lg">
      <div className="space-y-4 p-5">
        <p className="text-xs text-muted-foreground">
          The photo shown on each occasion&apos;s card in &quot;Dressed for the moment.&quot; Left blank keeps the
          existing plain bordered card.
        </p>
        <FramedPickerField label="Eid" image={images.eid} onImage={set("eid")} slug="eid" placements={["occasion.tile"]} framingMap={framing} onFramingMap={setFraming} />
        <FramedPickerField label="Daily Wear" image={images.everyday} onImage={set("everyday")} slug="everyday" placements={["occasion.tile"]} framingMap={framing} onFramingMap={setFraming} />
        <FramedPickerField label="Wedding" image={images.bridal} onImage={set("bridal")} slug="bridal" placements={["occasion.tile"]} framingMap={framing} onFramingMap={setFraming} />
        <FramedPickerField label="Prayer" image={images.prayer} onImage={set("prayer")} slug="prayer" placements={["occasion.tile"]} framingMap={framing} onFramingMap={setFraming} />
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

function GuidedFinderModal({ homepage, onClose, onSaved }) {
  const [image, setImage] = useState(homepage?.guidedFinderImage || "");
  const [framing, setFraming] = useState(homepage?.imageFraming || {});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveSettings({ homepage: { ...homepage, guidedFinderImage: image, imageFraming: framing } });
      toast.warning("Guided Discovery updated");
      onSaved({ homepage: saved.homepage });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Guided Discovery" size="lg">
      <div className="space-y-4 p-5">
        <p className="text-xs text-muted-foreground">
          The photo shown beside &quot;Not sure where to start?&quot; on desktop. Left blank keeps the existing plain
          placeholder.
        </p>
        <FramedPickerField label="Guided Discovery photo" image={image} onImage={setImage} placements={["guided.panel"]} framingMap={framing} onFramingMap={setFraming} />
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

function OccasionMenuModal({ homepage, onClose, onSaved }) {
  const [image, setImage] = useState(homepage?.occasionMenuImage || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveSettings({ homepage: { ...homepage, occasionMenuImage: image } });
      toast.warning("Occasions Menu updated");
      onSaved({ homepage: saved.homepage });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Occasions Menu" size="md">
      <div className="space-y-4 p-5">
        <p className="text-xs text-muted-foreground">
          The photo shown in the header&apos;s &quot;Occasions&quot; dropdown menu — a separate spot from the
          homepage&apos;s &quot;Dressed for the moment&quot; cards. Left blank keeps the existing plain placeholder.
        </p>
        <ImagePickerField label="Occasions menu photo" value={image} onChange={setImage} />
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
  const [framing, setFraming] = useState(homepage?.imageFraming || {});
  const [href, setHref] = useState(existing.href || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (enabled && !imageUrl.trim()) {
      toast.error("Add a banner image, or turn the banner off");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveSettings({ homepage: { ...homepage, banner: { enabled, imageUrl: imageUrl.trim(), href: href.trim() }, imageFraming: framing } });
      toast.warning("Banner updated");
      onSaved({ homepage: saved.homepage });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Banner" size="lg">
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
        <FramedPickerField label="Banner image" image={imageUrl} onImage={setImageUrl} placements={["banner.home"]} framingMap={framing} onFramingMap={setFraming} />
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
