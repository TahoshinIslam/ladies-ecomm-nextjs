// Browser-side helpers for the framing editor: read a picked file's real
// (as-displayed) pixel size and make its orientation unambiguous BEFORE upload.
//
// Why orientation matters: a phone JPEG is often stored sideways with an EXIF
// "rotate me" flag. Browsers apply the flag when displaying, so the editor
// would frame the upright picture — but the file sent to storage still holds
// the sideways pixels, and a crop drawn on one orientation misaligns on the
// other. So: parse the flag, and only when it is not "normal" re-draw the
// upright picture and upload THAT (an ordinary, un-flagged JPEG). Files with
// no orientation flag are uploaded byte-for-byte untouched.

/** EXIF orientation (1-8) of a JPEG, or 1 when absent / not a JPEG. */
export async function readExifOrientation(file) {
  if (!file || (file.type !== "image/jpeg" && file.type !== "image/jpg")) return 1;
  const view = new DataView(await file.slice(0, 128 * 1024).arrayBuffer());
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    if (marker === 0xffe1) {
      // APP1: "Exif\0\0" then a TIFF header.
      if (view.getUint32(offset + 4) !== 0x45786966) return 1;
      const tiff = offset + 10;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      const entries = view.getUint16(ifd, little);
      for (let i = 0; i < entries; i += 1) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > view.byteLength) return 1;
        if (view.getUint16(entry, little) === 0x0112) {
          const value = view.getUint16(entry + 8, little);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00) return 1;
    offset += 2 + length;
  }
  return 1;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("This file could not be read as an image."));
    img.src = url;
  });
}

/** Natural pixel size of an image URL (as browsers display it — orientation applied). */
export async function measureImageUrl(url) {
  const img = await loadImage(url);
  return { width: img.naturalWidth, height: img.naturalHeight };
}

/**
 * Reads a picked file. Returns { file, previewUrl, width, height, orientation,
 * normalized } — `file` is what should be uploaded (the untouched original
 * unless its orientation flag had to be baked in), `previewUrl` a blob URL the
 * caller must revoke when done.
 */
export async function readImageFile(file) {
  const orientation = await readExifOrientation(file);
  const originalUrl = URL.createObjectURL(file);
  let img;
  try {
    img = await loadImage(originalUrl);
  } catch (err) {
    URL.revokeObjectURL(originalUrl);
    throw err;
  }
  if (orientation === 1) {
    return { file, previewUrl: originalUrl, width: img.naturalWidth, height: img.naturalHeight, orientation, normalized: false };
  }
  // Browsers display the picture upright, so drawing it gives upright pixels.
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d").drawImage(img, 0, 0);
  URL.revokeObjectURL(originalUrl);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("This image's rotation could not be corrected.");
  const upright = new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  return {
    file: upright,
    previewUrl: URL.createObjectURL(upright),
    width: canvas.width,
    height: canvas.height,
    orientation,
    normalized: true,
  };
}
