"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Crop, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import Button from "../../ui/Button.jsx";
import FramePreview from "./FramePreview.jsx";
import ImageFramingEditor from "./ImageFramingEditor.jsx";
import { useUploadImageMutation } from "../../../store/shopApi.js";
import { cn } from "../../../lib/utils.js";
import { readImageFile } from "../../../lib/imageFileInfo.js";
import { checkResolution, formatAspect, getPlacement, recommendedSource, sanitizeFraming } from "../../../lib/imageFraming.js";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

/**
 * ONE reusable admin field for an image that is displayed in one or more
 * fixed destinations. It shows what each destination needs (frame shape,
 * recommended pixels), previews the image in each destination's exact frame,
 * and opens the framing editor to position it.
 *
 * Value model — `url` + `framings` (framing per destination key, see
 * lib/imageFraming.js); reports `onChange({ url, framings })`:
 *  - choosing a new file uploads the ORIGINAL through the existing
 *    /api/upload route (same auth, type/signature checks and size limit) only
 *    when the editor's Save is pressed; Cancel discards it and leaves the
 *    saved image untouched.
 *  - "Adjust framing" re-frames the already-saved image (no upload; the
 *    original stays as it is, so the edit is reversible).
 *  - `fallbackUrl`: shown when `url` is empty (e.g. a mobile slot that reuses
 *    the desktop image). Adjusting then saves ONLY a framing for that slot.
 */
export default function FramedImageInput({
  label,
  placements,
  folder = "promotions",
  url = "",
  framings = {},
  onChange,
  fallbackUrl = "",
  fallbackNote = "",
  maxFileMB = 5,
  className,
}) {
  const [uploadImage] = useUploadImageMutation();
  const inputRef = useRef(null);
  const dragCounter = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [reading, setReading] = useState(false);
  const [pending, setPending] = useState(null); // { file, previewUrl, width, height, normalized }
  const [adjusting, setAdjusting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const shownUrl = url || fallbackUrl;
  const usingFallback = !url && !!fallbackUrl;

  // Blob URLs hold memory until revoked.
  const previewUrl = pending?.previewUrl;
  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

  const closeEditor = useCallback(() => {
    setPending(null);
    setAdjusting(false);
    setError("");
  }, []);

  const processFile = async (file) => {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Only JPG, PNG, WebP or AVIF images are allowed");
      return;
    }
    if (file.size > maxFileMB * 1024 * 1024) {
      toast.error(`"${file.name}" is over ${maxFileMB} MB`);
      return;
    }
    setReading(true);
    try {
      const info = await readImageFile(file);
      if (info.file.size > maxFileMB * 1024 * 1024) {
        URL.revokeObjectURL(info.previewUrl);
        toast.error(`After correcting its rotation "${file.name}" is over ${maxFileMB} MB — resize it and try again`);
        return;
      }
      setError("");
      setPending(info);
    } catch (err) {
      toast.error(err.message || "This file could not be read as an image");
    } finally {
      setReading(false);
    }
  };

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    await processFile(file);
  };

  const onDrop = async (e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);
    await processFile(e.dataTransfer?.files?.[0]);
  };

  const saveNew = async ({ framings: saved }) => {
    setSaving(true);
    setError("");
    try {
      const res = await uploadImage({ file: pending.file, folder }).unwrap();
      // Trust the stored image's real size over what the browser measured.
      const next = { ...saved };
      if (res.width > 0 && res.height > 0 && (res.width !== pending.width || res.height !== pending.height)) {
        for (const key of Object.keys(next)) next[key] = sanitizeFraming({ ...next[key], w: res.width, h: res.height });
      }
      onChange?.({ url: res.url, framings: next });
      toast.success("Image uploaded and framed");
      closeEditor();
    } catch (err) {
      setError(err?.data?.message || err?.error || err?.message || "Upload failed — your framing is kept, try again.");
    } finally {
      setSaving(false);
    }
  };

  const saveExisting = ({ framings: saved }) => {
    onChange?.({ url, framings: { ...framings, ...saved } });
    closeEditor();
  };

  const clearImage = () => onChange?.({ url: "", framings: {} });

  return (
    <div
      onDragEnter={(e) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        dragCounter.current += 1;
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounter.current = Math.max(0, dragCounter.current - 1);
        if (dragCounter.current === 0) setIsDragOver(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className={cn(
        "space-y-3 rounded-lg border-2 border-dashed p-4 transition-colors",
        isDragOver ? "border-accent bg-accent/10" : "border-border",
        className,
      )}
    >
      <input ref={inputRef} type="file" accept={ALLOWED_TYPES.join(",")} onChange={onPick} className="hidden" aria-label={`${label} file`} />

      <div className="space-y-1">
        {placements.map((key) => {
          const p = getPlacement(key);
          const r = recommendedSource(key);
          return (
            <p key={key} className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{p.label}</span> · frame {formatAspect(key)} · recommended{" "}
              <span className="font-medium text-foreground">
                {r.recommended.width}×{r.recommended.height}px
              </span>{" "}
              (minimum {r.minimum.width}×{r.minimum.height})
            </p>
          );
        })}
        <p className="text-[11px] text-muted-foreground">
          Recommended pixels keep the image sharp on high-density screens; the on-screen size is responsive and can be smaller.
        </p>
      </div>

      {shownUrl ? (
        <div className="flex flex-wrap items-start gap-4">
          {placements.map((key) => {
            const f = sanitizeFraming(framings[key]);
            return (
              <div key={key} className="min-w-0 space-y-1">
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">
                  {getPlacement(key).label} · {formatAspect(key)}
                </p>
                <FramePreview placement={key} url={shownUrl} framing={f} maxWidthPx={key.startsWith("hero") || key.startsWith("banner") ? 320 : 220} />
                {f && (() => {
                  const c = checkResolution(key, f, { width: f.w, height: f.h });
                  return c.level === "ok" ? (
                    <p className="text-[11px] text-muted-foreground">
                      {f.w}×{f.h}px · {f.mode === "fit" ? "Fit" : f.mode === "free" ? "Stretched" : "Fill"}
                    </p>
                  ) : (
                    <p className={cn("flex max-w-[320px] items-start gap-1 text-[11px]", c.level === "insufficient" ? "text-danger" : "text-amber-600")}>
                      <AlertTriangle className="mt-0.5 h-3 w-3 flex-none" aria-hidden="true" /> {c.message}
                    </p>
                  );
                })()}
                {!f && <p className="text-[11px] text-muted-foreground">Not framed — shows as it always has.</p>}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No image yet — drag one here or choose a file.</p>
      )}

      {usingFallback && fallbackNote && <p className="text-xs text-muted-foreground">{fallbackNote}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => inputRef.current?.click()} disabled={reading}>
          {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          {url ? "Replace image" : "Choose image"}
        </Button>
        {shownUrl && (
          <Button type="button" size="sm" variant="subtle" onClick={() => setAdjusting(true)}>
            <Crop className="h-4 w-4" /> Adjust framing
          </Button>
        )}
        {url && (
          <Button type="button" size="sm" variant="subtle" onClick={clearImage}>
            <Trash2 className="h-4 w-4" /> Remove
          </Button>
        )}
      </div>

      {pending && (
        <ImageFramingEditor
          title={`Frame new image — ${label}`}
          placements={placements}
          source={{ url: pending.previewUrl, width: pending.width, height: pending.height }}
          initialFramings={{}}
          persistAll
          saving={saving}
          error={error}
          saveLabel="Upload & save"
          onSave={saveNew}
          onCancel={closeEditor}
        />
      )}
      {adjusting && !pending && (
        <ImageFramingEditor
          title={`Adjust framing — ${label}`}
          placements={placements}
          source={{ url: shownUrl }}
          initialFramings={framings}
          onSave={saveExisting}
          onCancel={closeEditor}
        />
      )}
    </div>
  );
}
