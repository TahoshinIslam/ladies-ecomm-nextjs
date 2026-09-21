import crypto from "crypto";

import User from "../models/userModel.js";
import { sendEmail, buildPasswordResetEmail } from "../utlis/sendEmail.js";
import { HttpError } from "../lib/http.js";
import { revokeAllSessionsForUser } from "../lib/session.js";
import { buildAppUrl } from "../lib/appUrl.js";
import { requireObjectIdFormat, isHexTokenFormat } from "../lib/validation.js";

// ========== SELF-SERVICE ==========

export async function updateMe(userId, body) {
  const user = await User.findById(userId);
  if (!user) throw new HttpError(404, "User not found");

  const { name, email, phone, avatar, currentPassword, newPassword } = body;

  // Pre-check email uniqueness for a clearer error than a raw duplicate-key error.
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
const FORGOT_PASSWORD_RESPONSE = { message: "If that email exists, a link has been sent." };

export async function forgotPassword(email) {
  const user = await User.findOne({ email });

  // Always respond identically regardless of what happens below — whether
  // the account doesn't exist, CLIENT_URL is misconfigured, or SMTP send
  // fails, the PUBLIC response must be indistinguishable in every case.
  if (!user) return FORGOT_PASSWORD_RESPONSE;

  const rawToken = crypto.randomBytes(32).toString("hex");
  user.resetPasswordToken = crypto.createHash("sha256").update(rawToken).digest("hex");
  user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
  await user.save();

  try {
    // buildAppUrl throws on a missing/malformed CLIENT_URL — treated the
    // same as a send failure below, never surfaced to the caller.
    const resetUrl = buildAppUrl("reset-password", rawToken);
    const tpl = buildPasswordResetEmail(user.name, resetUrl);
    await sendEmail({ to: user.email, ...tpl });
  } catch (err) {
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();
    // Never logs the raw token or the user's email — just enough to alert
    // ops that delivery/config is broken.
    console.error("forgotPassword: failed to send reset email", err?.message || err);
  }

  return FORGOT_PASSWORD_RESPONSE;
}

export async function resetPassword(token, password) {
  // Same generic 400 as the not-found case below — a malformed token must
  // never be distinguishable from a well-formed-but-unknown one.
  if (!isHexTokenFormat(token)) throw new HttpError(400, "Invalid or expired reset link");
  const hashed = crypto.createHash("sha256").update(token).digest("hex");
  const user = await User.findOne({ resetPasswordToken: hashed, resetPasswordExpires: { $gt: new Date() } });

  if (!user) throw new HttpError(400, "Invalid or expired reset link");

  user.password = password;
  user.resetPasswordToken = null;
  user.resetPasswordExpires = null;
  // Clear any active lockout so they can log in immediately with the new password.
  user.loginAttempts = 0;
  user.lockUntil = null;
  await user.save();

  // Every session this user had — on any device, any browser — must stop
  // working the moment their password changes via reset.
  await revokeAllSessionsForUser(user._id);

  return { message: "Password updated. Please log in." };
}

// ========== ADMIN ==========

const ADMIN_USER_WRITABLE_FIELDS = ["name", "email", "role", "isVerified", "permissions"];
const VALID_ROLES = ["customer", "employee", "admin"];

// listUsers, getUserById, updateUser and deleteUser used to live here. They
// served the user-administration endpoints, which moved to the admin
// dashboard along with the rest of shop management — and with them the only
// reason this app had to know about roles or permissions at all. What is
// left is what a shopper does with their own account: change their profile,
// and recover their password.
