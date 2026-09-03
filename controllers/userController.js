import crypto from "crypto";
import bcrypt from "bcryptjs";
import asyncHandler from "../middleware/asyncHandler.js";
import User from "../models/userModel.js";
import generateToken from "../utils/generateToken.js";
import logger from "../utils/logger.js";
import {
  sendEmail,
  buildVerificationEmail,
  buildPasswordResetEmail,
} from "../utils/sendEmail.js";

// Dummy bcrypt hash used to equalize login timing on non-existent users.
// Generated once at startup from a random string — the actual value doesn't matter.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 12);

// Bearer-token auth: no server-side session to clear. The client is responsible
// for discarding its stored token on logout / password reset.

// @desc    Register new user
// @route   POST /api/users/register
// @access  Public
export const registerUser = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  const exists = await User.findOne({ email });
  if (exists) {
    res.status(400);
    throw new Error("Email already registered");
  }

  const user = await User.create({ name, email, password });

  const rawToken = crypto.randomBytes(32).toString("hex");
  user.verificationToken = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");
  await user.save({ validateBeforeSave: false });

  const verifyUrl = `${process.env.CLIENT_URL}/verify-email/${rawToken}`;
  try {
    const tpl = buildVerificationEmail(user.name, verifyUrl);
    await sendEmail({ to: user.email, ...tpl });
  } catch (err) {
    logger.warn(
      { err, userId: user._id.toString() },
      "Verification email not sent",
    );
  }

  const token = generateToken(user._id);

  res.status(201).json({
    success: true,
    token,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isVerified: user.isVerified,
    },
  });
});

// @desc    Verify email
// @route   GET /api/users/verify-email/:token
// @access  Public
export const verifyEmail = asyncHandler(async (req, res) => {
  const hashed = crypto
    .createHash("sha256")
    .update(req.params.token)
    .digest("hex");
  const user = await User.findOne({ verificationToken: hashed }).select(
    "+verificationToken",
  );

  if (!user) {
    res.status(400);
    throw new Error("Invalid or expired verification link");
  }

  user.isVerified = true;
  user.verificationToken = undefined;
  await user.save({ validateBeforeSave: false });

  res.json({ success: true, message: "Email verified" });
});

// @desc    Login
// @route   POST /api/users/login
// @access  Public
export const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select(
    "+password +loginAttempts +lockUntil",
  );

  // Timing-safe: always run a bcrypt compare, even when user doesn't exist.
  // Otherwise an attacker can enumerate valid emails by response time.
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    res.status(401);
    throw new Error("Invalid credentials");
  }

  if (user.isLocked) {
    res.status(423);
    throw new Error(
      "Account temporarily locked due to too many failed attempts. Try again in 15 minutes.",
    );
  }

  const ok = await user.matchPassword(password);
  if (!ok) {
    await user.incLoginAttempts();
    res.status(401);
    throw new Error("Invalid credentials");
  }

  await user.resetLoginAttempts();
  const token = generateToken(user._id);

  res.json({
    success: true,
    token,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      isVerified: user.isVerified,
    },
  });
});

// @desc    Logout (clear cookie)
// @route   POST /api/users/logout
// @access  Private
export const logoutUser = asyncHandler(async (req, res) => {
  res.json({ success: true, message: "Logged out" });
});

// @desc    Get current user
// @route   GET /api/users/me
// @access  Private
export const getMe = asyncHandler(async (req, res) => {
  res.json({ success: true, user: req.user });
});

// @desc    Update current user profile
// @route   PUT /api/users/me
// @access  Private
export const updateMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("+password");
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  const { name, email, phone, avatar, currentPassword, newPassword } = req.body;

  // Pre-check email uniqueness for a clearer error than E11000
  if (email && email !== user.email) {
    const taken = await User.findOne({ email });
    if (taken) {
      res.status(400);
      throw new Error("Email already in use");
    }
    user.email = email;
    user.isVerified = false; // require re-verification on email change
  }

  if (name) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (avatar !== undefined) user.avatar = avatar;

  if (newPassword) {
    if (!currentPassword) {
      res.status(400);
      throw new Error("Current password required to set new password");
    }
    const ok = await user.matchPassword(currentPassword);
    if (!ok) {
      res.status(400);
      throw new Error("Current password is incorrect");
    }
    user.password = newPassword;
  }

  await user.save();

  res.json({
    success: true,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatar: user.avatar,
      role: user.role,
    },
  });
});

// @desc    Request password reset
// @route   POST /api/users/forgot-password
// @access  Public
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  // Always respond success to avoid leaking existence
  if (!user) {
    return res.json({
      success: true,
      message: "If that email exists, a link has been sent.",
    });
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  user.resetPasswordToken = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");
  user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.CLIENT_URL}/reset-password/${rawToken}`;
  try {
    const tpl = buildPasswordResetEmail(user.name, resetUrl);
    await sendEmail({ to: user.email, ...tpl });
  } catch (err) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save({ validateBeforeSave: false });
    res.status(500);
    throw new Error("Email could not be sent");
  }

  res.json({
    success: true,
    message: "If that email exists, a link has been sent.",
  });
});

// @desc    Reset password
// @route   POST /api/users/reset-password/:token
// @access  Public
export const resetPassword = asyncHandler(async (req, res) => {
  const hashed = crypto
    .createHash("sha256")
    .update(req.params.token)
    .digest("hex");
  const user = await User.findOne({
    resetPasswordToken: hashed,
    resetPasswordExpires: { $gt: Date.now() },
  }).select("+resetPasswordToken +resetPasswordExpires");

  if (!user) {
    res.status(400);
    throw new Error("Invalid or expired reset link");
  }

  user.password = req.body.password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  // Clear any active lockouts so they can log in immediately
  user.loginAttempts = 0;
  user.lockUntil = undefined;
  await user.save();

  res.json({ success: true, message: "Password updated. Please log in." });
});

// ======= ADMIN =======

// Fields an admin is allowed to change on another user.
const ADMIN_USER_WRITABLE_FIELDS = [
  "name",
  "email",
  "role",
  "isVerified",
  "permissions",
];

const VALID_ROLES = ["customer", "employee", "admin"];

// Permissions an admin can grant to an employee. Kept in sync with the
// authorize(...) calls in routes/*.
const VALID_PERMISSIONS = [
  "readOrders",
  "manageOrders",
  "readReviews",
  "manageReviews",
  "manageProducts",
  "manageCategories",
  "manageBrands",
  "manageCoupons",
  "manageThemes",
  "manageSettings",
  "manageUploads",
  "readAnalytics",
  "readNotifications",
];

// @desc    Get all users
// @route   GET /api/users
// @access  Admin
export const getAllUsers = asyncHandler(async (req, res) => {
  const users = await User.find().sort("-createdAt");
  res.json({ success: true, count: users.length, users });
});

// @desc    Get user by id
// @route   GET /api/users/:id
// @access  Admin
export const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }
  res.json({ success: true, user });
});

// @desc    Update user (admin can change name, email, role, verified, permissions)
// @route   PUT /api/users/:id
// @access  Admin
export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  // Whitelist: admin cannot set password, tokens, lockouts, etc. through this route.
  const updates = {};
  for (const key of ADMIN_USER_WRITABLE_FIELDS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  // Footgun guard: an admin cannot demote themselves or strip their own
  // permissions. If the only admin demotes themselves the system loses its
  // last admin and nobody can repair it through the UI.
  const isSelf = user._id.toString() === req.user._id.toString();
  if (isSelf && (updates.role !== undefined || updates.permissions !== undefined)) {
    res.status(400);
    throw new Error("You cannot change your own role or permissions");
  }

  if (updates.role && !VALID_ROLES.includes(updates.role)) {
    res.status(400);
    throw new Error("Invalid role");
  }

  if (updates.permissions !== undefined) {
    if (!Array.isArray(updates.permissions)) {
      res.status(400);
      throw new Error("Permissions must be an array");
    }
    const bad = updates.permissions.filter(
      (p) => !VALID_PERMISSIONS.includes(p),
    );
    if (bad.length) {
      res.status(400);
      throw new Error(`Invalid permission(s): ${bad.join(", ")}`);
    }
  }

  // Permissions only meaningful for employees. Clear them for other roles
  // so a demoted employee doesn't keep latent rights.
  const finalRole = updates.role ?? user.role;
  if (finalRole !== "employee") {
    updates.permissions = [];
  }

  if (updates.email && updates.email !== user.email) {
    const taken = await User.findOne({ email: updates.email });
    if (taken && taken._id.toString() !== user._id.toString()) {
      res.status(400);
      throw new Error("Email already in use");
    }
  }

  // Audit log for role changes — promoting to admin/employee is security-sensitive.
  if (updates.role && updates.role !== user.role) {
    logger.info(
      {
        audit: "role_change",
        targetUserId: user._id.toString(),
        targetEmail: user.email,
        fromRole: user.role,
        toRole: updates.role,
        adminUserId: req.user._id.toString(),
        adminEmail: req.user.email,
      },
      "Admin changed user role",
    );
  }
  Object.assign(user, updates);
  await user.save();
  res.json({ success: true, user });
});

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Admin
export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }
  if (user.role === "admin") {
    res.status(400);
    throw new Error("Cannot delete an admin user");
  }
  await user.deleteOne();
  res.json({ success: true, message: "User deleted" });
});
