import cloudinary, { cloudinaryConfigured } from "../config/cloudinary.js";

/**
 * Upload a buffer (from multer memoryStorage) to Cloudinary.
 * @param {Buffer} buffer
 * @param {string} folder - destination folder
 */
export const uploadBuffer = (buffer, folder = "shoestore") =>
  new Promise((resolve, reject) => {
    if (!cloudinaryConfigured) {
      return reject(
        new Error(
          "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your .env file.",
        ),
      );
    }
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(buffer);
  });

export const deleteImage = (publicId) => {
  if (!cloudinaryConfigured) {
    return Promise.reject(
      new Error(
        "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your .env file.",
      ),
    );
  }
  return cloudinary.uploader.destroy(publicId, { resource_type: "image" });
};
