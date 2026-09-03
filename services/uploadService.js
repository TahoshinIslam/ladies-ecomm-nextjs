import { uploadBuffer, deleteImage } from "../utlis/cloudinaryUpload.js";
import { cloudinaryConfigured } from "../config/cloudinary.js";
import { HttpError } from "../lib/http.js";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif"]);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// Cloudinary errors carry { http_code, message, error: { ... } } — ported
// from controllers/uploadController.js's formatCloudinaryError.
function formatCloudinaryError(err) {
  const httpCode = err?.http_code || err?.error?.http_code;
  const reason = err?.error?.message || err?.message || "Unknown Cloudinary error";

  if (httpCode === 401) {
    return new HttpError(503, "Cloudinary credentials are invalid. Check CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET.");
  }
  if (httpCode === 420 || /rate/i.test(reason)) {
    return new HttpError(429, "Cloudinary rate limit hit. Try again shortly.");
  }
  return new HttpError(502, `Cloudinary upload failed: ${reason}`);
}

async function validateAndBuffer(file) {
  if (!file) throw new HttpError(400, "No file uploaded.");
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new HttpError(
      415,
      `File "${file.name}" is not an allowed image type. Allowed: jpeg, jpg, png, webp, avif.`,
    );
  }
  if (file.size > MAX_BYTES) {
    throw new HttpError(413, `File "${file.name}" is over 5 MB.`);
  }
  const arrayBuffer = await file.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function uploadSingle(file, folder = "shoestore") {
  if (!cloudinaryConfigured) {
    throw new HttpError(
      503,
      "Image hosting is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
    );
  }
  const buffer = await validateAndBuffer(file);
  try {
    const result = await uploadBuffer(buffer, folder);
    return { url: result.secure_url, publicId: result.public_id, width: result.width, height: result.height };
  } catch (err) {
    throw formatCloudinaryError(err);
  }
}

export async function uploadMany(files, folder = "shoestore") {
  if (!cloudinaryConfigured) {
    throw new HttpError(
      503,
      "Image hosting is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
    );
  }
  if (!files?.length) throw new HttpError(400, "No files uploaded.");
  if (files.length > 8) throw new HttpError(400, "Max 8 files per request.");

  try {
    const buffers = await Promise.all(files.map(validateAndBuffer));
    const results = await Promise.all(buffers.map((buf) => uploadBuffer(buf, folder)));
    return results.map((r) => ({
      url: r.secure_url,
      publicId: r.public_id,
      width: r.width,
      height: r.height,
    }));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw formatCloudinaryError(err);
  }
}

export async function removeImage(publicId) {
  if (!cloudinaryConfigured) throw new HttpError(503, "Image hosting is not configured.");
  try {
    return await deleteImage(publicId);
  } catch (err) {
    throw formatCloudinaryError(err);
  }
}
