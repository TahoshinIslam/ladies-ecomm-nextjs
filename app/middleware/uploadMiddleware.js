import multer from "multer";
import path from "path";

// Memory storage → we stream buffer straight to Cloudinary (no disk writes)
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|webp|avif/;
  const ext = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  if (ext && mime) return cb(null, true);
  // Tag the error so the wrapper below can map it to a 415.
  const err = new Error(
    `File "${file.originalname}" is not an allowed image type. Allowed: jpeg, jpg, png, webp, avif.`,
  );
  err.code = "UNSUPPORTED_FILE_TYPE";
  cb(err);
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

/**
 * Wrap a multer middleware so its errors get readable status codes instead of
 * falling through to the generic 500 handler. Without this, an oversize file
 * looks identical to a server crash in the client.
 */
export const handleUpload = (multerMiddleware) => (req, res, next) => {
  multerMiddleware(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413);
        return next(new Error("File too large. Max 5 MB per image."));
      }
      if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
        res.status(400);
        return next(new Error(err.message));
      }
      res.status(400);
      return next(err);
    }
    if (err.code === "UNSUPPORTED_FILE_TYPE") {
      res.status(415);
      return next(err);
    }
    res.status(400);
    return next(err);
  });
};
