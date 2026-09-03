"use client";

import { useRef, useState } from "react";
import { motion, Reorder } from "framer-motion";
import { UploadCloud, Upload, X, GripVertical, Loader2 } from "lucide-react";
import { toast } from "sonner";

import Button from "../ui/Button.jsx";
import {
  useUploadImageMutation,
  useUploadMultipleMutation,
} from "../../store/shopApi.js";
import { cn } from "../../lib/utils.js";

/**
 * Image dropzone with:
 *  - Native HTML5 drag-and-drop from the desktop (Chrome / Safari / Firefox).
 *  - Click-to-pick fallback (mobile Safari can't drop, but `<input type="file">` works).
 *  - Thumbnail strip with framer-motion `Reorder` for drag-to-reorder.
 *  - Multi-file upload (parallel, batched at 8 because /upload/multiple's cap).
 *
 * Returns image URLs as strings — caller stores them in whatever shape it wants.
 */
export default function ImageDropzone({
  value = [],
  onChange,
  folder = "products",
  maxFileMB = 5,
  className,
}) {
  const [uploadImage, { isLoading: uploadingOne }] = useUploadImageMutation();
  const [uploadMultiple, { isLoading: uploadingMany }] =
    useUploadMultipleMutation();
  const uploading = uploadingOne || uploadingMany;

  const [isDragOver, setIsDragOver] = useState(false);
  // dragLeave fires when the cursor crosses any child element. Counter pattern
  // keeps the highlight stable while the cursor moves between nested nodes.
  const dragCounter = useRef(0);
  const fileInputRef = useRef(null);

  const processFiles = async (rawFiles) => {
    const all = Array.from(rawFiles || []);
    if (all.length === 0) return;

    const images = all.filter((f) => f.type.startsWith("image/"));
    const skipped = all.length - images.length;
    if (images.length === 0) {
      toast.error("Only image files (JPG, PNG, WebP, AVIF) are allowed");
      return;
    }
    if (skipped > 0) {
      toast.error(`Skipped ${skipped} non-image file${skipped === 1 ? "" : "s"}`);
    }

    const oversized = images.filter((f) => f.size > maxFileMB * 1024 * 1024);
    if (oversized.length > 0) {
      toast.error(
        `${oversized.length} file${oversized.length === 1 ? "" : "s"} over ${maxFileMB} MB and skipped`,
      );
    }
    const usable = images.filter((f) => f.size <= maxFileMB * 1024 * 1024);
    if (usable.length === 0) return;

    try {
      const urls = [];
      if (usable.length === 1) {
        const res = await uploadImage({ file: usable[0], folder }).unwrap();
        urls.push(res.url);
      } else {
        // /upload/multiple caps at 8 per request — chunk if more were picked.
        for (let i = 0; i < usable.length; i += 8) {
          const batch = usable.slice(i, i + 8);
          const res = await uploadMultiple({ files: batch, folder }).unwrap();
          urls.push(...res.files.map((f) => f.url));
        }
      }
      onChange?.([...(value || []), ...urls]);
      toast.success(`Uploaded ${urls.length} image${urls.length === 1 ? "" : "s"}`);
    } catch (err) {
      // The backend returns a specific message — show it instead of "Upload failed".
      const msg =
        err?.data?.message ||
        err?.error ||
        err?.message ||
        "Upload failed";
      toast.error(msg);
    }
  };

  const handleFileInputChange = async (e) => {
    await processFiles(e.target.files);
    e.target.value = "";
  };

  const openFilePicker = (e) => {
    e?.stopPropagation();
    fileInputRef.current?.click();
  };

  // --- drag handlers ---
  const onDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer?.types?.includes("Files")) return;
    dragCounter.current += 1;
    setIsDragOver(true);
  };
  const onDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragOver(false);
  };
  const onDragOver = (e) => {
    // Required: without preventDefault here, the browser blocks the drop event.
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const onDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragOver(false);
    const files = e.dataTransfer?.files;
    if (files?.length) await processFiles(files);
  };

  const removeAt = (idx) => {
    onChange?.(value.filter((_, i) => i !== idx));
  };
  const reorder = (next) => {
    onChange?.(next);
  };

  return (
    <div
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "rounded-lg border-2 border-dashed p-6 transition-colors",
        isDragOver
          ? "border-accent bg-accent/10"
          : "border-border hover:border-accent/50",
        className,
      )}
    >
      {/* Hidden file input — triggered by the button (and tap-to-pick on mobile) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Thumbnails (only when there are images). Sits inside the dropzone so
          users can keep dropping more files even when there are images. */}
      {value.length > 0 && (
        <div
          className="mb-5 flex items-start gap-2 overflow-x-auto pb-2"
          // stop drag events here from firing the parent onClick fallback
          onClick={(e) => e.stopPropagation()}
        >
          <Reorder.Group
            axis="x"
            as="div"
            values={value}
            onReorder={reorder}
            className="flex flex-shrink-0 gap-2"
          >
            {value.map((img, i) => (
              <Reorder.Item
                key={img}
                value={img}
                as="div"
                whileDrag={{
                  scale: 1.08,
                  zIndex: 10,
                  boxShadow: "0 8px 20px rgba(0,0,0,0.25)",
                }}
                className="group relative h-20 w-20 flex-shrink-0 cursor-grab overflow-hidden rounded-md border border-border bg-muted touch-none active:cursor-grabbing"
              >
                <img
                  src={img}
                  alt=""
                  draggable={false}
                  className="pointer-events-none h-full w-full select-none object-cover"
                />
                {i === 0 && (
                  <span className="pointer-events-none absolute bottom-0 left-0 right-0 bg-accent/90 px-1 py-0.5 text-center text-[9px] font-bold uppercase tracking-wider text-accent-foreground">
                    Cover
                  </span>
                )}
                <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/40 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <GripVertical className="h-3 w-3" />
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAt(i);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label="Remove image"
                  className="absolute right-0.5 top-0.5 rounded-full bg-danger p-0.5 text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        </div>
      )}

      {/* Drop hint + upload button */}
      <motion.div
        animate={{ scale: isDragOver ? 1.04 : 1 }}
        transition={{ duration: 0.15 }}
        className="flex flex-col items-center justify-center gap-3 py-2 text-center"
      >
        {uploading ? (
          <Loader2 className="h-10 w-10 animate-spin text-accent" />
        ) : (
          <UploadCloud
            className={cn(
              "h-10 w-10 transition-colors",
              isDragOver ? "text-accent" : "text-muted-foreground",
            )}
          />
        )}
        <div>
          <p className="text-sm font-medium text-foreground">
            {isDragOver ? "Drop to upload" : "Drag & drop images here"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            PNG, JPG, WebP · up to {maxFileMB} MB each · pick multiple at once
          </p>
        </div>
        <Button type="button" size="sm" onClick={openFilePicker} disabled={uploading}>
          <Upload className="h-4 w-4" />
          {uploading
            ? "Uploading..."
            : value.length > 0
              ? "Add more"
              : "Upload file"}
        </Button>
      </motion.div>
    </div>
  );
}
