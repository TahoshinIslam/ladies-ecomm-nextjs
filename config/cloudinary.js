import { v2 as cloudinary } from "cloudinary";

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
  process.env;

const isConfigured =
  !!CLOUDINARY_CLOUD_NAME && !!CLOUDINARY_API_KEY && !!CLOUDINARY_API_SECRET;

if (isConfigured) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
} else {
  console.warn(
    "⚠️  Cloudinary is not configured. Uploads will fail until CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are set in your .env file.",
  );
}

export const cloudinaryConfigured = isConfigured;
export default cloudinary;
