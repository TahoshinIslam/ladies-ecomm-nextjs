// Phase 5 — magic-byte (file-signature) detection for uploaded images.
//
// Fixes the confirmed defect in services/uploadService.js's
// validateAndBuffer(): it only ever checked the browser/client-supplied
// `file.type` (attacker-controlled multipart metadata, not derived from
// the file's actual bytes) against an allowlist — a renamed HTML/script
// file with a spoofed `Content-Type: image/png` passed straight through to
// Cloudinary. This module inspects the real leading bytes of the buffer
// instead.
//
// No new dependency — every format this app actually accepts (JPEG, PNG,
// WebP, AVIF) has a short, well-documented, easily hand-written magic
// number; adding a package for this would be more surface area than the
// four `startsWith`-shaped checks below.
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function bytesMatch(buffer, offset, expected) {
  if (buffer.length < offset + expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (buffer[offset + i] !== expected[i]) return false;
  }
  return true;
}

function isWebp(buffer) {
  // RIFF <4-byte size> WEBP
  return (
    buffer.length >= 12 &&
    bytesMatch(buffer, 0, [0x52, 0x49, 0x46, 0x46]) && // "RIFF"
    bytesMatch(buffer, 8, [0x57, 0x45, 0x42, 0x50]) // "WEBP"
  );
}

function isAvif(buffer) {
  // ISOBMFF: 4-byte box size, "ftyp", then a 4-byte major brand. AVIF's
  // major brand is "avif" (still image) or "avis" (image sequence).
  if (buffer.length < 12) return false;
  if (!bytesMatch(buffer, 4, [0x66, 0x74, 0x79, 0x70])) return false; // "ftyp"
  const brand = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11]);
  return brand === "avif" || brand === "avis";
}

// Returns the detected MIME type ("image/jpeg" | "image/png" |
// "image/webp" | "image/avif"), or null if the buffer's leading bytes
// don't match any known, supported image signature — covers a truncated/
// corrupt file, random bytes, HTML/script/SVG (all plain text, no binary
// magic number), or any format this app doesn't accept.
export function detectImageSignature(buffer) {
  if (!buffer || buffer.length === 0) return null;
  if (bytesMatch(buffer, 0, JPEG_MAGIC)) return "image/jpeg";
  if (bytesMatch(buffer, 0, PNG_MAGIC)) return "image/png";
  if (isWebp(buffer)) return "image/webp";
  if (isAvif(buffer)) return "image/avif";
  return null;
}

// jpeg/jpg are the same signature and the same real format — declared
// MIME "image/jpg" (non-standard but sent by some clients) is treated as
// equivalent to "image/jpeg" for the agreement check below.
const MIME_ALIASES = { "image/jpg": "image/jpeg" };

export function normalizeDeclaredType(type) {
  return MIME_ALIASES[type] || type;
}
