import logger from "../utils/logger.js";

export const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

export const errorHandler = (err, req, res, next) => {
  let statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  let message = err.message || "Server Error";

  // CSRF (csrf-csrf throws ForbiddenError with code EBADCSRFTOKEN)
  if (
    err.code === "EBADCSRFTOKEN" ||
    err.code === "ERR_BAD_CSRF_TOKEN" ||
    err.name === "ForbiddenError" ||
    /invalid csrf token/i.test(err.message || "")
  ) {
    statusCode = 403;
    message = "Invalid or missing CSRF token. Refresh the page and try again.";
  }
  // Errors thrown with explicit { status: N } (do this AFTER CSRF so CSRF wins)
  else if (err.status && typeof err.status === "number") {
    statusCode = err.status;
  } else if (err.name === "CastError" && err.kind === "ObjectId") {
    statusCode = 404;
    message = "Resource not found";
  } else if (err.code === 11000) {
    statusCode = 400;
    const field = Object.keys(err.keyValue || {})[0] || "field";
    message = `Duplicate ${field}: ${err.keyValue?.[field]} already exists`;
  } else if (err.name === "ValidationError") {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(", ");
  } else if (err.name === "MissingSchemaError") {
    statusCode = 500;
    message = `Populate failed: ${err.message}`;
  } else if (err.name === "JsonWebTokenError") {
    statusCode = 401;
    message = "Invalid token";
  } else if (err.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Session expired, please log in again";
  }

  // Call logger directly (not via a detached variable) so `this` binding is preserved.
  const logPayload = {
    err: { name: err.name, message: err.message, stack: err.stack },
    requestId: req.id,
    path: req.originalUrl,
    method: req.method,
    userId: req.user?._id?.toString(),
  };
  if (statusCode >= 500) {
    logger.error(logPayload, `Request failed: ${message}`);
  } else {
    logger.warn(logPayload, `Request failed: ${message}`);
  }

  if (res.headersSent) {
    return;
  }

  res.status(statusCode).json({
    success: false,
    message,
    requestId: req.id,
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
  });
};
