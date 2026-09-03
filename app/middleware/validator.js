import { validationResult } from "express-validator";

// Runs after a chain of express-validator checks; returns 400 with all errors
export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const formatted = errors.array().map((e) => ({ field: e.path, msg: e.msg }));
  res.status(400).json({ success: false, message: "Validation failed", errors: formatted });
};
