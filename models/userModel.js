import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false,
    },
    role: {
      type: String,
      enum: ["customer", "employee", "admin"],
      default: "customer",
    },
    permissions: {
      type: [String],
      default: [],
    },
    avatar: {
      type: String,
      default: "",
    },
    phone: {
      type: String,
      default: "",
    },
    // Admin-controlled trust flag (see views/admin/UsersPage.jsx) — not
    // part of a self-service email-verification flow (there isn't one:
    // no code ever generates a verification token).
    isVerified: {
      type: Boolean,
      default: false,
    },
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      select: false,
    },
    loginAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    lockUntil: {
      type: Date,
      select: false,
    },
    lastLogin: {
      type: Date,
    },

    // First-order promo (e.g. free shipping on first order). Once true, the
    // user has consumed this benefit and cannot use it again — even if they
    // cancel that first order. Toggled atomically inside the order
    // transaction so concurrent orders can't both claim it.
    firstOrderPromoUsed: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// Hash password before saving
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

// Compare entered password with stored hash
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Lockout helpers
userSchema.virtual("isLocked").get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

userSchema.methods.incLoginAttempts = async function () {
  // If previous lock expired, reset attempts
  if (this.lockUntil && this.lockUntil < Date.now()) {
    this.loginAttempts = 1;
    this.lockUntil = undefined;
  } else {
    this.loginAttempts += 1;
    // Lock for 15 min after 5 failed attempts
    if (this.loginAttempts >= 5 && !this.isLocked) {
      this.lockUntil = Date.now() + 15 * 60 * 1000;
    }
  }
  await this.save({ validateBeforeSave: false });
};

userSchema.methods.resetLoginAttempts = async function () {
  this.loginAttempts = 0;
  this.lockUntil = undefined;
  this.lastLogin = new Date();
  await this.save({ validateBeforeSave: false });
};

// Guards against Next.js dev's hot-reload re-executing this module and
// trying to re-register an already-compiled model.
const userModel = mongoose.models.users || mongoose.model("users", userSchema);
export default userModel;
