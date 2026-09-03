"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Palette,
  Plus,
  Check,
  Trash2,
  Save,
  Sparkles,
  Eye,
  Sun,
  Moon,
  Power,
} from "lucide-react";
import { toast } from "sonner";

import Input from "../../components/ui/Input.jsx";
import Select from "../../components/ui/Select.jsx";
import Textarea from "../../components/ui/Textarea.jsx";
import Button from "../../components/ui/Button.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Modal from "../../components/ui/Modal.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import Skeleton from "../../components/ui/Skeleton.jsx";
import AdminErrorState from "../../components/admin/AdminErrorState.jsx";

import {
  useListThemesQuery,
  useCreateThemeMutation,
  useUpdateThemeMutation,
  useActivateThemeMutation,
  useDeleteThemeMutation,
  useSeedPresetsMutation,
} from "../../store/themeApi.js";
import { cn } from "../../lib/utils.js";

const COLOR_FIELDS = [
  { key: "primary", label: "Primary", desc: "Main brand color (buttons, logo)" },
  { key: "primaryForeground", label: "Primary text", desc: "Text on primary bg" },
  { key: "accent", label: "Accent", desc: "Highlights, links, badges" },
  { key: "accentForeground", label: "Accent text", desc: "Text on accent bg" },
  { key: "background", label: "Background", desc: "Main page background" },
  { key: "foreground", label: "Foreground", desc: "Main text color" },
  { key: "muted", label: "Muted", desc: "Secondary/disabled areas" },
  { key: "mutedForeground", label: "Muted text", desc: "Secondary text" },
  { key: "border", label: "Border", desc: "Card/input borders" },
  { key: "success", label: "Success", desc: "Success states" },
  { key: "warning", label: "Warning", desc: "Warning states" },
  { key: "danger", label: "Danger", desc: "Error/destructive states" },
];

const FONT_OPTIONS = [
  { value: "Inter, system-ui, sans-serif", label: "Inter (default)" },
  { value: "'Space Grotesk', Inter, sans-serif", label: "Space Grotesk" },
  { value: "'Plus Jakarta Sans', Inter, sans-serif", label: "Plus Jakarta Sans" },
  { value: "'DM Sans', Inter, sans-serif", label: "DM Sans" },
  { value: "'Outfit', Inter, sans-serif", label: "Outfit" },
  { value: "Georgia, 'Times New Roman', serif", label: "Serif (Georgia)" },
  { value: "'JetBrains Mono', monospace", label: "Monospace" },
];

export default function AdminThemesPage() {
  const { data, isLoading, isError, error, refetch } = useListThemesQuery();
  const themes = data?.themes ?? [];

  const [editing, setEditing] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const [seedPresets, { isLoading: seeding }] = useSeedPresetsMutation();
  const [activateTheme, { isLoading: activating }] = useActivateThemeMutation();
  const [deleteTheme, { isLoading: deleting }] = useDeleteThemeMutation();

  const handleSeedPresets = async () => {
    try {
      const res = await seedPresets().unwrap();
      if (res.created > 0) toast.success(`Added ${res.created} preset theme${res.created === 1 ? "" : "s"}`);
      else toast("Presets already exist", { icon: "ℹ️" });
    } catch (e) {
      toast.error(e?.data?.message || "Could not seed presets");
    }
  };

  const handleActivate = async (theme) => {
    try {
      await activateTheme(theme._id).unwrap();
      toast.success(`"${theme.name}" is now live across the site`);
    } catch (e) {
      toast.error(e?.data?.message || "Could not activate");
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteTheme(confirmDelete._id).unwrap();
      toast.success("Theme deleted");
      setConfirmDelete(null);
    } catch (e) {
      toast.error(e?.data?.message || "Could not delete");
    }
  };

  if (editing) {
    return (
      <ThemeEditor
        theme={editing}
        onClose={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black flex items-center gap-3">
            <Palette className="h-7 w-7 text-accent" />
            Theme Manager
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Change colors, fonts and feature toggles. The active theme reskins
            the entire site live for every visitor.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSeedPresets} loading={seeding}>
            <Sparkles className="h-4 w-4" />
            Seed presets
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New theme
          </Button>
        </div>
      </div>

      {/* Theme grid */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : isError ? (
        <AdminErrorState
          title="Couldn't load themes"
          message={error?.data?.message || "Your session may have expired. Try again."}
          onRetry={refetch}
        />
      ) : themes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <Palette className="mx-auto h-10 w-10 text-muted-foreground" />
          <h3 className="mt-4 font-heading font-bold">No themes yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Seed presets to get started, or create one from scratch.
          </p>
          <Button className="mt-4" onClick={handleSeedPresets}>
            <Sparkles className="h-4 w-4" />
            Seed 5 presets
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {themes.map((t) => (
            <ThemeCard
              key={t._id}
              theme={t}
              onEdit={() => setEditing(t)}
              onActivate={() => handleActivate(t)}
              onDelete={() => setConfirmDelete(t)}
              activating={activating}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      <CreateThemeModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(t) => { setCreateOpen(false); setEditing(t); }} />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={`Delete "${confirmDelete?.name}"?`}
        description="This theme will be permanently removed."
        loading={deleting}
      />
    </div>
  );
}

// =================== THEME CARD ===================
function ThemeCard({ theme, onEdit, onActivate, onDelete, activating }) {
  const c = theme.colors || {};
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "overflow-hidden rounded-lg border bg-background transition-all",
        theme.isActive
          ? "border-accent ring-2 ring-accent/20 shadow-card"
          : "border-border hover:border-foreground/40"
      )}
    >
      {/* Preview */}
      <div
        className="relative h-28"
        style={{ background: c.background || "#fff" }}
      >
        {/* stripe showing colors */}
        <div className="absolute inset-x-0 top-0 flex h-2">
          <div style={{ background: c.primary, flex: 1 }} />
          <div style={{ background: c.accent, flex: 1 }} />
          <div style={{ background: c.success, flex: 0.5 }} />
          <div style={{ background: c.warning, flex: 0.5 }} />
          <div style={{ background: c.danger, flex: 0.5 }} />
        </div>
        {/* fake UI preview */}
        <div className="flex h-full items-center justify-center gap-2">
          <span
            className="h-6 px-3 rounded inline-flex items-center text-xs font-bold"
            style={{
              background: c.primary,
              color: c.primaryForeground || "#fff",
            }}
          >
            Button
          </span>
          <span
            className="h-6 px-3 rounded inline-flex items-center text-xs font-bold"
            style={{
              background: c.accent,
              color: c.accentForeground || "#fff",
            }}
          >
            Accent
          </span>
        </div>
        {theme.isActive && (
          <div className="absolute right-2 top-2">
            <Badge variant="accent">
              <Check className="h-3 w-3" />
              LIVE
            </Badge>
          </div>
        )}
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-heading font-bold">{theme.name}</h3>
            <div className="mt-1 flex flex-wrap gap-1">
              {Object.entries(c)
                .slice(0, 6)
                .map(([key, value]) => (
                  <span
                    key={key}
                    title={`${key}: ${value}`}
                    className="h-4 w-4 rounded-full border border-border"
                    style={{ background: value }}
                  />
                ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button size="sm" variant="outline" onClick={onEdit} className="flex-1">
            Edit
          </Button>
          {!theme.isActive ? (
            <>
              <Button size="sm" onClick={onActivate} loading={activating}>
                <Power className="h-3 w-3" />
                Activate
              </Button>
              <Button size="sm" variant="ghost" onClick={onDelete} aria-label="Delete">
                <Trash2 className="h-3 w-3 text-danger" />
              </Button>
            </>
          ) : (
            <Button size="sm" disabled className="flex-1">
              <Check className="h-3 w-3" />
              Active
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// =================== CREATE MODAL ===================
function CreateThemeModal({ open, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [cloneFrom, setCloneFrom] = useState("");
  const { data } = useListThemesQuery();
  const [createTheme, { isLoading }] = useCreateThemeMutation();
  const themes = data?.themes ?? [];

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("Name required");
      return;
    }
    try {
      const source = cloneFrom ? themes.find((t) => t._id === cloneFrom) : null;
      const body = source
        ? {
            name: name.trim(),
            colors: source.colors,
            darkColors: source.darkColors,
            fonts: source.fonts,
            radius: source.radius,
            features: source.features,
          }
        : { name: name.trim() };
      const res = await createTheme(body).unwrap();
      toast.success("Theme created");
      setName("");
      setCloneFrom("");
      onCreated?.(res.theme);
    } catch (e) {
      toast.error(e?.data?.message || "Could not create");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create new theme" size="sm">
      <div className="space-y-4 p-5">
        <Input
          label="Theme name"
          placeholder="e.g. Christmas 2026"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Select
          label="Clone from (optional)"
          value={cloneFrom}
          onChange={(e) => setCloneFrom(e.target.value)}
        >
          <option value="">Start from defaults</option>
          {themes.map((t) => (
            <option key={t._id} value={t._id}>
              {t.name}
            </option>
          ))}
        </Select>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} loading={isLoading}>
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// =================== THEME EDITOR ===================
function ThemeEditor({ theme, onClose }) {
  const [formData, setFormData] = useState(() => ({
    name: theme.name,
    siteName: theme.siteName || "",
    tagline: theme.tagline || "",
    logoUrl: theme.logoUrl || "",
    faviconUrl: theme.faviconUrl || "",
    radius: theme.radius || "0.75rem",
    colors: { ...theme.colors },
    darkColors: { ...theme.darkColors },
    fonts: { ...theme.fonts },
    features: { ...theme.features },
  }));
  const [previewDark, setPreviewDark] = useState(false);
  const [updateTheme, { isLoading }] = useUpdateThemeMutation();
  const [activateTheme, { isLoading: activating }] = useActivateThemeMutation();

  const updateColor = (mode, key, value) => {
    setFormData((f) => ({
      ...f,
      [mode]: { ...f[mode], [key]: value },
    }));
  };

  const updateFeature = (key, value) => {
    setFormData((f) => ({
      ...f,
      features: { ...f.features, [key]: value },
    }));
  };

  const handleSave = async ({ thenActivate = false } = {}) => {
    try {
      await updateTheme({ id: theme._id, ...formData }).unwrap();
      if (thenActivate && !theme.isActive) {
        await activateTheme(theme._id).unwrap();
        toast.success("Saved & activated — site re-skinned");
      } else {
        toast.success(theme.isActive ? "Saved — site re-skinned live" : "Theme saved");
      }
    } catch (e) {
      toast.error(e?.data?.message || "Could not save");
    }
  };

  const currentColors = previewDark ? formData.darkColors : formData.colors;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back to themes
          </button>
          <h1 className="mt-1 font-heading text-3xl font-black flex items-center gap-2">
            Editing: {formData.name}
            {theme.isActive && <Badge variant="accent">LIVE</Badge>}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {theme.isActive
              ? "Changes apply instantly across the entire site when you save."
              : "Save and activate to make these changes go live."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSave} loading={isLoading}>
            <Save className="h-4 w-4" />
            Save
          </Button>
          {!theme.isActive && (
            <Button onClick={() => handleSave({ thenActivate: true })} loading={isLoading || activating}>
              <Power className="h-4 w-4" />
              Save & activate
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Editor panels */}
        <div className="space-y-6">
          <Section title="Identity">
            <Input
              label="Theme name"
              value={formData.name}
              onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Site name"
                value={formData.siteName}
                onChange={(e) => setFormData((f) => ({ ...f, siteName: e.target.value }))}
              />
              <Input
                label="Logo URL"
                placeholder="https://..."
                value={formData.logoUrl}
                onChange={(e) => setFormData((f) => ({ ...f, logoUrl: e.target.value }))}
              />
            </div>
            <Textarea
              label="Tagline"
              rows={2}
              value={formData.tagline}
              onChange={(e) => setFormData((f) => ({ ...f, tagline: e.target.value }))}
            />
          </Section>

          <Section
            title="Colors"
            action={
              <div className="flex rounded-md border border-border bg-background p-0.5">
                <button
                  onClick={() => setPreviewDark(false)}
                  className={cn(
                    "flex items-center gap-1 rounded px-3 py-1 text-xs font-semibold transition-colors",
                    !previewDark ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                  )}
                >
                  <Sun className="h-3 w-3" /> Light
                </button>
                <button
                  onClick={() => setPreviewDark(true)}
                  className={cn(
                    "flex items-center gap-1 rounded px-3 py-1 text-xs font-semibold transition-colors",
                    previewDark ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                  )}
                >
                  <Moon className="h-3 w-3" /> Dark
                </button>
              </div>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {COLOR_FIELDS.map((f) => (
                <ColorPicker
                  key={f.key}
                  label={f.label}
                  desc={f.desc}
                  value={currentColors[f.key] || "#000000"}
                  onChange={(v) =>
                    updateColor(previewDark ? "darkColors" : "colors", f.key, v)
                  }
                />
              ))}
            </div>
          </Section>

          <Section title="Typography & shape">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Heading font"
                value={formData.fonts.heading || ""}
                onChange={(e) =>
                  setFormData((f) => ({
                    ...f,
                    fonts: { ...f.fonts, heading: e.target.value },
                  }))
                }
              >
                {FONT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <Select
                label="Body font"
                value={formData.fonts.body || ""}
                onChange={(e) =>
                  setFormData((f) => ({
                    ...f,
                    fonts: { ...f.fonts, body: e.target.value },
                  }))
                }
              >
                {FONT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">
                Border radius:{" "}
                <span className="font-mono text-accent">{formData.radius}</span>
              </label>
              <div className="flex gap-2">
                {["0rem", "0.25rem", "0.5rem", "0.75rem", "1rem", "1.5rem"].map((r) => (
                  <button
                    key={r}
                    onClick={() => setFormData((f) => ({ ...f, radius: r }))}
                    className={cn(
                      "h-10 flex-1 border text-xs font-medium transition-colors",
                      formData.radius === r
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border hover:border-foreground/40"
                    )}
                    style={{ borderRadius: r }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Features">
            <div className="space-y-2">
              <Toggle
                label="Enable dark mode toggle"
                desc="Show a sun/moon switcher in the header"
                checked={formData.features.enableDarkMode !== false}
                onChange={(v) => updateFeature("enableDarkMode", v)}
              />
              <Toggle
                label="Enable animations"
                desc="Page transitions, hover effects, stagger reveals"
                checked={formData.features.enableAnimations !== false}
                onChange={(v) => updateFeature("enableAnimations", v)}
              />
              <Toggle
                label="Enable wishlist"
                desc="Let customers save items"
                checked={formData.features.enableWishlist !== false}
                onChange={(v) => updateFeature("enableWishlist", v)}
              />
              <Toggle
                label="Enable compare"
                desc="Compare products side-by-side"
                checked={formData.features.enableCompare !== false}
                onChange={(v) => updateFeature("enableCompare", v)}
              />
              <Toggle
                label="Enable reviews"
                desc="Show customer reviews on product pages"
                checked={formData.features.enableReviews !== false}
                onChange={(v) => updateFeature("enableReviews", v)}
              />
              <Toggle
                label="Enable coupons"
                desc="Show coupon input at checkout"
                checked={formData.features.enableCoupons !== false}
                onChange={(v) => updateFeature("enableCoupons", v)}
              />
            </div>
            <Input
              label="Announcement bar text"
              placeholder="e.g. Free shipping on orders over ৳2,000"
              value={formData.features.announcementBar || ""}
              onChange={(e) => updateFeature("announcementBar", e.target.value)}
              hint="Shows as a thin banner at the very top of the site"
            />
          </Section>
        </div>

        {/* Live preview sidebar */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <LivePreview theme={formData} dark={previewDark} />
        </aside>
      </div>
    </div>
  );
}

// =================== SUB COMPONENTS ===================
function Section({ title, children, action }) {
  return (
    <div className="rounded-lg border border-border bg-background p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="font-heading font-bold">{title}</h3>
        {action}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function ColorPicker({ label, desc, value, onChange }) {
  return (
    <div>
      <label className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-[10px] text-muted-foreground">{desc}</span>
      </label>
      <div className="flex items-center gap-2 rounded-md border border-border bg-background p-1.5">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 border-0 bg-transparent text-sm font-mono focus:outline-none"
        />
      </div>
    </div>
  );
}

function Toggle({ label, desc, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-md border border-border p-3 hover:bg-muted/30">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 flex-shrink-0 rounded-full transition-colors",
          checked ? "bg-accent" : "bg-muted"
        )}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-background shadow-soft",
            checked ? "right-0.5" : "left-0.5"
          )}
        />
      </button>
    </label>
  );
}

function LivePreview({ theme, dark }) {
  const c = dark ? theme.darkColors : theme.colors;
  // Apply theme's font fallback via inline style
  const style = {
    background: c.background,
    color: c.foreground,
    fontFamily: theme.fonts.body,
    borderRadius: theme.radius,
  };

  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">
      <div className="flex items-center justify-between border-b border-border p-3">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Eye className="h-3 w-3" />
          Live preview
        </span>
        <Badge variant={dark ? "default" : "outline"}>
          {dark ? "Dark" : "Light"} mode
        </Badge>
      </div>

      <div className="p-4" style={style}>
        <div className="rounded-lg border p-5" style={{ borderColor: c.border, borderRadius: theme.radius }}>
          {/* Simulated navbar */}
          <div className="mb-4 flex items-center justify-between">
            <span
              className="font-black"
              style={{ fontFamily: theme.fonts.heading, color: c.foreground }}
            >
              {theme.siteName || "TAHOS."}
              <span style={{ color: c.accent }}>.</span>
            </span>
            <span
              className="h-6 px-2 rounded inline-flex items-center text-xs font-bold"
              style={{
                background: c.muted,
                color: c.mutedForeground,
                borderRadius: `calc(${theme.radius} - 4px)`,
              }}
            >
              Cart (2)
            </span>
          </div>

          {/* Simulated heading */}
          <h2
            className="mb-1 text-xl font-black"
            style={{ fontFamily: theme.fonts.heading, color: c.foreground }}
          >
            Fresh arrivals.
          </h2>
          <p className="mb-4 text-sm" style={{ color: c.mutedForeground }}>
            {theme.tagline || "Step into something new."}
          </p>

          {/* Buttons */}
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              className="px-3 py-1.5 text-xs font-bold"
              style={{
                background: c.primary,
                color: c.primaryForeground,
                borderRadius: `calc(${theme.radius} - 4px)`,
              }}
            >
              Shop now
            </button>
            <button
              className="px-3 py-1.5 text-xs font-bold"
              style={{
                background: c.accent,
                color: c.accentForeground,
                borderRadius: `calc(${theme.radius} - 4px)`,
              }}
            >
              Featured
            </button>
            <button
              className="border px-3 py-1.5 text-xs font-bold"
              style={{
                borderColor: c.border,
                color: c.foreground,
                borderRadius: `calc(${theme.radius} - 4px)`,
              }}
            >
              Browse
            </button>
          </div>

          {/* Status badges */}
          <div className="flex gap-2">
            <span
              className="px-2 py-0.5 text-[10px] font-bold"
              style={{
                background: c.success + "25",
                color: c.success,
                borderRadius: "9999px",
              }}
            >
              ● Paid
            </span>
            <span
              className="px-2 py-0.5 text-[10px] font-bold"
              style={{
                background: c.warning + "25",
                color: c.warning,
                borderRadius: "9999px",
              }}
            >
              ● Pending
            </span>
            <span
              className="px-2 py-0.5 text-[10px] font-bold"
              style={{
                background: c.danger + "25",
                color: c.danger,
                borderRadius: "9999px",
              }}
            >
              ● Cancelled
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
