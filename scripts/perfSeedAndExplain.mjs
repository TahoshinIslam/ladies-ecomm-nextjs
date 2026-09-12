// Performance audit Closure Pass 2 — Section 9 evidence gathering.
//
// Seeds a representative volume of synthetic data into the DISPOSABLE
// LOCAL TEST DATABASE ONLY (refuses to run unless MONGO_URI_TEST points at
// a database whose name contains "test" — same guard pattern as
// tests/helpers/testDb.mjs), then runs `explain("executionStats")` against
// the hot queries this pass touched (or is auditing) and prints a compact
// table: winning index, docs examined, keys examined, rows returned, sort
// stage, execution time.
//
// Every document created here is identifiable by real, already-schema'd
// fields with a distinctive "Perf Seed"/"perfseed-" prefix (NOT a made-up
// extra field — insertMany() silently drops undeclared fields even with
// `{strict: false}` passed as a per-call option on these schemas, learned
// the hard way when a first attempt at a synthetic `perfSeed` flag field
// never actually persisted) so `--cleanup` can remove exactly this
// script's own synthetic data afterward — never a real fixture some other
// test file created.
//
// Usage:
//   node --env-file=.env.test scripts/perfSeedAndExplain.mjs           (seed + explain)
//   node --env-file=.env.test scripts/perfSeedAndExplain.mjs --cleanup (remove only tagged docs)
import mongoose from "mongoose";

const uri = process.env.MONGO_URI_TEST;
if (!uri) throw new Error("MONGO_URI_TEST is not set — refusing to run against anything else.");
const dbNameMatch = /\/([^/?]+)(\?|$)/.exec(uri);
const dbName = dbNameMatch?.[1];
if (!dbName || !/test/i.test(dbName)) {
  throw new Error(`Refusing to run — database name "${dbName}" does not contain "test".`);
}

await mongoose.connect(uri);
console.log(`Connected to ${dbName} (perf seed/explain — disposable test DB only)`);

const { default: Product } = await import("../models/productModel.js");
const { default: Category } = await import("../models/categoryModel.js");
const { default: User } = await import("../models/userModel.js");
const { default: Order } = await import("../models/orderModel.js");
const { default: Review } = await import("../models/reviewModel.js");

const CLEANUP = process.argv.includes("--cleanup");

if (CLEANUP) {
  const results = await Promise.all([
    Product.deleteMany({ name: /^Perf Seed Product/ }),
    User.deleteMany({ email: /^perfseed-/ }),
    Order.deleteMany({ "shippingAddress.fullName": "Perf Seed Buyer" }),
    Review.deleteMany({ comment: "Synthetic — safe to delete." }),
  ]);
  console.log("Cleaned up synthetic documents:", {
    products: results[0].deletedCount,
    users: results[1].deletedCount,
    orders: results[2].deletedCount,
    reviews: results[3].deletedCount,
  });
  await mongoose.disconnect();
  process.exit(0);
}

function rand(n) {
  return Math.floor(Math.random() * n);
}

console.log("Seeding representative synthetic data...");

const dept = await Category.findOne({ slug: "burqa" }).lean();
if (!dept) throw new Error("Expected seed category 'burqa' to already exist — run the real catalog seed first.");
const leaf = await Category.findOne({ parent: dept._id }).lean();

const products = [];
for (let i = 0; i < 300; i++) {
  products.push({
    name: `Perf Seed Product ${i}`,
    description: "Synthetic — created by scripts/perfSeedAndExplain.mjs, safe to delete.",
    category: leaf._id,
    // insertMany() bypasses the pre('save') hook that normally derives
    // this from `category` — set it explicitly so the seeded products
    // actually match the isActive+topCategory query being explained below.
    topCategory: dept._id,
    basePrice: 500 + rand(5000),
    isActive: rand(10) > 0, // ~90% active
    images: ["https://placehold.co/400x400?text=perf"],
    variants: [{ variantName: "Default", sku: `PERF-${i}`, stock: rand(50) }],
  });
}
const insertedProducts = await Product.insertMany(products);
console.log(`Inserted ${insertedProducts.length} products under Burqa/${leaf.name}`);

const users = [];
for (let i = 0; i < 60; i++) {
  users.push({
    name: `Perf Seed User ${i}`,
    email: `perfseed-${i}@example.invalid`,
    password: "PerfSeed123!",
    role: "customer",
    isVerified: true,
  });
}
const insertedUsers = await User.insertMany(users);
console.log(`Inserted ${insertedUsers.length} users`);

const orders = [];
const statuses = ["pending", "paid", "processing", "shipped", "delivered", "cancelled"];
for (let i = 0; i < 150; i++) {
  const p = insertedProducts[rand(insertedProducts.length)];
  orders.push({
    user: insertedUsers[rand(insertedUsers.length)]._id,
    items: [
      {
        product: p._id,
        variantId: p.variants[0]._id,
        quantity: 1 + rand(3),
        snapshot: { name: p.name, sku: p.variants[0].sku, price: p.basePrice },
      },
    ],
    shippingAddress: {
      fullName: "Perf Seed Buyer",
      phone: "01800000000",
      street: "1 Perf Seed Lane",
      city: "Dhaka",
      postalCode: "1200",
      country: "Bangladesh",
    },
    subtotal: p.basePrice,
    total: p.basePrice,
    status: statuses[rand(statuses.length)],
  });
}
const insertedOrders = await Order.insertMany(orders);
console.log(`Inserted ${insertedOrders.length} orders`);

const reviews = [];
for (let i = 0; i < 400; i++) {
  const p = insertedProducts[rand(insertedProducts.length)];
  const u = insertedUsers[rand(insertedUsers.length)];
  reviews.push({
    user: u._id,
    product: p._id,
    rating: 1 + rand(5),
    title: "Perf seed review",
    comment: "Synthetic — safe to delete.",
  });
}
try {
  await Review.insertMany(reviews, { ordered: false });
} catch {
  // Some (user, product) pairs may collide with the unique index across
  // random draws — expected and harmless for volume purposes; whichever
  // inserted still gives a representative sample.
}
const reviewCount = await Review.countDocuments({ comment: "Synthetic — safe to delete." });
console.log(`Inserted ${reviewCount} reviews`);

console.log("\n=== explain(\"executionStats\") evidence ===\n");

async function explainAndPrint(label, cursor) {
  const stats = await cursor.explain("executionStats");
  const winning = stats.queryPlanner?.winningPlan;
  const exec = stats.executionStats;
  const indexUsed =
    winning?.inputStage?.indexName ||
    winning?.inputStage?.inputStage?.indexName ||
    winning?.indexName ||
    (winning?.stage === "COLLSCAN" ? "COLLSCAN (no index)" : winning?.stage);
  const hasSort =
    JSON.stringify(winning).includes('"SORT"') && !JSON.stringify(winning).includes('"IXSCAN"');
  console.log(
    `${label}\n  index: ${indexUsed}\n  docsExamined: ${exec.totalDocsExamined}  keysExamined: ${exec.totalKeysExamined}  nReturned: ${exec.nReturned}\n  executionTimeMs: ${exec.executionTimeMillis}  in-memory sort stage present: ${hasSort}\n`,
  );
}

await explainAndPrint(
  "Product listing — shop browse (isActive + topCategory, sort -createdAt)",
  Product.find({ isActive: true, topCategory: dept._id }).sort({ createdAt: -1 }).limit(20),
);

await explainAndPrint(
  "Product reviews — PDP reviews tab (product filter, sort -createdAt)",
  Review.find({ product: insertedProducts[0]._id }).sort({ createdAt: -1 }).limit(10),
);

await explainAndPrint(
  "Admin orders list — no filter, sort -createdAt",
  Order.find({}).sort({ createdAt: -1 }).skip(0).limit(20),
);

await explainAndPrint(
  "Admin orders list — status filter (paid), sort -createdAt",
  Order.find({ status: "paid" }).sort({ createdAt: -1 }).skip(0).limit(20),
);

await explainAndPrint(
  "Admin users list — no filter, sort -createdAt",
  User.find({}).sort({ createdAt: -1 }).skip(0).limit(20),
);

await explainAndPrint(
  "Customer order history — getMyOrders (user filter, sort -createdAt)",
  Order.find({ user: insertedUsers[0]._id }).sort({ createdAt: -1 }),
);

await explainAndPrint(
  "Admin reviews list — listAllReviews, no filter, sort -createdAt",
  Review.find({}).sort({ createdAt: -1 }).skip(0).limit(20),
);

await mongoose.disconnect();
console.log("\nDone. Run with --cleanup to remove this script's synthetic documents.");
