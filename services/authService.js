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
});

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
