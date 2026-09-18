// Performance audit Closure Pass 2 — creates (or resets) one synthetic
// admin account in the DISPOSABLE LOCAL TEST DATABASE ONLY, for manual
// browser-based verification (DataTable render profiling, admin
// walkthroughs). Same DB_NAME-must-look-like-a-test-database safety guard
// (lib/testDbSafety.js) as scripts/httpTestServer.mjs. Uses the real User
// model so the password hash goes through the normal save() hashing path
// (models/userModel.js) — never a raw insert.
//
// Usage: node --env-file=.env.test scripts/seedTestAdmin.mjs
import { checkTestDbConfig } from "../lib/testDbSafety.js";

const dbCheck = checkTestDbConfig({
  dbName: process.env.DB_NAME,
  host: process.env.DB_HOST || "127.0.0.1",
  allowRemoteHost: process.env.ALLOW_REMOTE_TEST_DB === "true",
});
if (!dbCheck.ok) {
  throw new Error(`Refusing to run against this database: ${dbCheck.reason}`);
}

const { default: connectDB, closePool } = await import("../config/db.js");
const { default: User } = await import("../models/userModel.js");

await connectDB();

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

await closePool();
