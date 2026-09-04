import crypto from "crypto";

import User from "../models/userModel.js";
import { sendEmail, buildPasswordResetEmail } from "../utlis/sendEmail.js";
import { HttpError } from "../lib/http.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { revokeAllSessionsForUser } from "../lib/session.js";

// ========== SELF-SERVICE ==========

export async function updateMe(userId, body) {
  const user = await User.findById(userId).select("+password");
  if (!user) throw new HttpError(404, "User not found");

  const { name, email, phone, avatar, currentPassword, newPassword } = body;

  // Pre-check email uniqueness for a clearer error than a raw E11000.
  if (email && email !== user.email) {
    const taken = await User.findOne({ email });
    if (taken) throw new HttpError(400, "Email already in use");
    user.email = email;
    user.isVerified = false; // require re-verification on email change
  }

  if (name) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (avatar !== undefined) user.avatar = avatar;

  if (newPassword) {
    if (!currentPassword) throw new HttpError(400, "Current password required to set new password");
    const ok = await user.matchPassword(currentPassword);
    if (!ok) throw new HttpError(400, "Current password is incorrect");
    user.password = newPassword;
  }

  await user.save();
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    avatar: user.avatar,
    role: user.role,
  };
}

// Real SMTP credentials aren't configured in this environment (no SMTP_HOST
// etc. in .env) — sendEmail() will throw. Rather than let that surface as a
// raw 500 or silently pretend an email went out, the reset token is still
// generated and stored correctly (so the feature is real once SMTP is
// configured), and a failed send rolls the token back and reports clearly.
export async function forgotPassword(email) {
  const user = await User.findOne({ email });

  // Always respond success either way to avoid leaking which emails exist.
  if (!user) return { message: "If that email exists, a link has been sent." };

  const rawToken = crypto.randomBytes(32).toString("hex");
  user.resetPasswordToken = crypto.createHash("sha256").update(rawToken).digest("hex");
  user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.CLIENT_URL || ""}/reset-password/${rawToken}`;
  try {
    const tpl = buildPasswordResetEmail(user.name, resetUrl);
    await sendEmail({ to: user.email, ...tpl });
  } catch (err) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save({ validateBeforeSave: false });
    throw new HttpError(500, "Email could not be sent");
  }

  return { message: "If that email exists, a link has been sent." };
}

export async function resetPassword(token, password) {
  const hashed = crypto.createHash("sha256").update(token).digest("hex");
  const user = await User.findOne({
    resetPasswordToken: hashed,
    resetPasswordExpires: { $gt: Date.now() },
  }).select("+resetPasswordToken +resetPasswordExpires");

  if (!user) throw new HttpError(400, "Invalid or expired reset link");

  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  // Clear any active lockout so they can log in immediately with the new password.
  user.loginAttempts = 0;
  user.lockUntil = undefined;
  await user.save();

  // Every session this user had — on any device, any browser — must stop
  // working the moment their password changes via reset. A previously
  // issued session cookie is rejected the next time it's used (see
  // lib/session.js's validateSessionToken, which checks revokedAt).
  await revokeAllSessionsForUser(user._id);

  return { message: "Password updated. Please log in." };
}

export async function verifyEmail(token) {
  const hashed = crypto.createHash("sha256").update(token).digest("hex");
  const user = await User.findOne({ verificationToken: hashed }).select("+verificationToken");
  if (!user) throw new HttpError(400, "Invalid or expired verification link");

  user.isVerified = true;
  user.verificationToken = undefined;
  await user.save({ validateBeforeSave: false });

  return { message: "Email verified" };
}

// ========== ADMIN ==========

const ADMIN_USER_WRITABLE_FIELDS = ["name", "email", "role", "isVerified", "permissions"];
const VALID_ROLES = ["customer", "employee", "admin"];

// Derived from lib/permissions.js — the same constants the route guards and
// the frontend's usePermission() check against, so an admin can never
// assign an employee a permission string that nothing actually enforces.
const VALID_PERMISSIONS = Object.values(PERMISSIONS);

const USER_SORT_FIELDS = { name: "name", email: "email", role: "role", createdAt: "createdAt" };

export async function listUsers({ page = 1, limit = 20, search, sortBy, sortOrder, role } = {}) {
  const filter = {};
  if (role) filter.role = role;
  if (search && String(search).trim()) {
    const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [{ name: new RegExp(escaped, "i") }, { email: new RegExp(escaped, "i") }];
  }

  const sortField = USER_SORT_FIELDS[sortBy] || "createdAt";
  const sortDir = sortOrder === "asc" ? 1 : -1;
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Number(limit) || 20);
  const skip = (pageNum - 1) * limitNum;

  const [users, total] = await Promise.all([
    User.find(filter).sort({ [sortField]: sortDir }).skip(skip).limit(limitNum),
    User.countDocuments(filter),
  ]);
  return {
    users,
    total,
    page: pageNum,
    limit: limitNum,
    pages: Math.max(1, Math.ceil(total / limitNum)),
  };
}

export async function getUserById(id) {
  const user = await User.findById(id);
  if (!user) throw new HttpError(404, "User not found");
  return user;
}

export async function updateUser(id, body, actingUser) {
  const user = await User.findById(id);
  if (!user) throw new HttpError(404, "User not found");

  const updates = {};
  for (const key of ADMIN_USER_WRITABLE_FIELDS) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  // An admin cannot demote themselves or strip their own permissions — the
  // last admin doing this would lock everyone out of the admin panel with
  // no UI path to undo it.
  const isSelf = user._id.toString() === actingUser._id.toString();
  if (isSelf && (updates.role !== undefined || updates.permissions !== undefined)) {
    throw new HttpError(400, "You cannot change your own role or permissions");
  }

  if (updates.role && !VALID_ROLES.includes(updates.role)) {
    throw new HttpError(400, "Invalid role");
  }

  if (updates.permissions !== undefined) {
    if (!Array.isArray(updates.permissions)) throw new HttpError(400, "Permissions must be an array");
    const bad = updates.permissions.filter((p) => !VALID_PERMISSIONS.includes(p));
    if (bad.length) throw new HttpError(400, `Invalid permission(s): ${bad.join(", ")}`);
  }

  // Permissions only mean anything for employees — clear them for any other
  // role so a demoted employee doesn't keep latent rights.
  const finalRole = updates.role ?? user.role;
  if (finalRole !== "employee") updates.permissions = [];

  if (updates.email && updates.email !== user.email) {
    const taken = await User.findOne({ email: updates.email });
    if (taken && taken._id.toString() !== user._id.toString()) {
      throw new HttpError(400, "Email already in use");
    }
  }

  Object.assign(user, updates);
  await user.save();
  return user;
}

export async function deleteUser(id) {
  const user = await User.findById(id);
  if (!user) throw new HttpError(404, "User not found");
  if (user.role === "admin") throw new HttpError(400, "Cannot delete an admin user");
  await user.deleteOne();
}
