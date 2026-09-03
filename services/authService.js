import crypto from "crypto";
import bcrypt from "bcryptjs";

import User from "../models/userModel.js";
import generateToken from "../utlis/generateToken.js";
import { HttpError } from "../lib/http.js";

// Dummy hash used to equalize login timing on non-existent users, so an
// attacker can't enumerate valid emails by response time. Ported from
// controllers/userController.js's loginUser.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 12);

const publicUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  avatar: user.avatar,
  isVerified: user.isVerified,
  // Without this, an employee's session never carries what they were
  // actually granted — the sidebar filter and every permission check on the
  // frontend silently fall back to "no permissions" regardless of what's
  // stored on their account. Empty for customers/admins (admins bypass
  // permission checks entirely via role in lib/permissions.js).
  permissions: user.permissions || [],
});

export async function register({ name, email, password }) {
  if (!name || !email || !password) {
    throw new HttpError(400, "Name, email, and password are required");
  }

  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    throw new HttpError(400, "An account with this email already exists");
  }

  const user = await User.create({ name, email, password });
  const token = generateToken(user._id);

  return { token, user: publicUser(user) };
}

export async function login({ email, password }) {
  const user = await User.findOne({ email }).select("+password +loginAttempts +lockUntil");

  if (!user) {
    await bcrypt.compare(password || "", DUMMY_HASH);
    throw new HttpError(401, "Invalid credentials");
  }

  if (user.isLocked) {
    throw new HttpError(
      423,
      "Account temporarily locked due to too many failed attempts. Try again in 15 minutes.",
    );
  }

  const ok = await user.matchPassword(password || "");
  if (!ok) {
    await user.incLoginAttempts();
    throw new HttpError(401, "Invalid credentials");
  }

  await user.resetLoginAttempts();
  const token = generateToken(user._id);

  return { token, user: publicUser(user) };
}

export function getMe(user) {
  return publicUser(user);
}
