import jwt from "jsonwebtoken";
import asyncHandler from "./asyncHandler.js";
import User from "../models/userModel.js";

// Protect: requires valid JWT (from httpOnly cookie or Authorization header)
export const protect = asyncHandler(async (req, res, next) => {
  let token;

  // 1. Prefer cookie (set by login endpoint)
  if (req.cookies?.jwt) {
    token = req.cookies.jwt;
  }
  // 2. Fallback: Authorization: Bearer <token>
  else if (req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    res.status(401);
    throw new Error("Not authorized, no token");
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findById(decoded.id);
  if (!user) {
    res.status(401);
    throw new Error("User no longer exists");
  }

  req.user = user;
  next();
});

// Admin guard — run AFTER protect
export const admin = (req, res, next) => {
  if (req.user && req.user.role === "admin") return next();
  res.status(403);
  throw new Error("Admin access only");
};

/**
 * Permission-based guard — run AFTER protect.
 * - Admin role → always allowed.
 * - Employee role → allowed if they have the specific permission.
 * - Otherwise → 403.
 */
export const authorize = (permission) => (req, res, next) => {
  if (!req.user) {
    res.status(401);
    throw new Error("Not authorized");
  }
  if (req.user.role === "admin") return next();
  if (
    req.user.role === "employee" &&
    req.user.permissions?.includes(permission)
  ) {
    return next();
  }
  res.status(403);
  throw new Error(`Forbidden: requires '${permission}' permission`);
};

// Optional role check factory
export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (req.user && roles.includes(req.user.role)) return next();
    res.status(403);
    throw new Error(`Requires one of: ${roles.join(", ")}`);
  };
