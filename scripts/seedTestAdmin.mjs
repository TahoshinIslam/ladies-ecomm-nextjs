// Performance audit Closure Pass 2 — creates (or resets) one synthetic
// admin account in the DISPOSABLE LOCAL TEST DATABASE ONLY, for manual
// browser-based verification (DataTable render profiling, admin
// walkthroughs). Same MONGO_URI_TEST-only safety guard as
// scripts/perfSeedAndExplain.mjs. Uses the real User model so the
// password hash goes through the normal pre('save') hook — never a raw
// insert.
//
// Usage: node --env-file=.env.test scripts/seedTestAdmin.mjs
import mongoose from "mongoose";

const uri = process.env.MONGO_URI_TEST;
if (!uri) throw new Error("MONGO_URI_TEST is not set — refusing to run against anything else.");
if (!/test/i.test(uri)) throw new Error("MONGO_URI_TEST does not look like a test database — refusing to run.");

await mongoose.connect(uri);
const { default: User } = await import("../models/userModel.js");

const EMAIL = "perfseed-admin@example.invalid";
const PASSWORD = "PerfSeedAdmin123!";

let admin = await User.findOne({ email: EMAIL });
if (!admin) {
  admin = await User.create({
    name: "Perf Seed Admin",
    email: EMAIL,
    password: PASSWORD,
    role: "admin",
    isVerified: true,
  });
  console.log(`Created synthetic admin: ${EMAIL}`);
} else {
  console.log(`Synthetic admin already exists: ${EMAIL}`);
}

await mongoose.disconnect();
