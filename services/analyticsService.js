import Order from "../models/orderModel.js";
import User from "../models/userModel.js";
import Product from "../models/productModel.js";
import Review from "../models/reviewModel.js";

const REVENUE_STATUSES = ["paid", "processing", "shipped", "delivered"];

export async function getOverview() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalOrders,
    totalRevenueAgg,
    monthlyRevenueAgg,
    totalUsers,
    newUsers30,
    totalProducts,
    outOfStock,
    pendingOrders,
    avgRatingAgg,
  ] = await Promise.all([
    Order.countDocuments({ status: { $nin: ["cancelled", "refunded"] } }),
    Order.aggregate([
      { $match: { status: { $in: REVENUE_STATUSES } } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    Order.aggregate([
      {
        $match: {
          status: { $in: REVENUE_STATUSES },
          createdAt: { $gte: startOfMonth },
        },
      },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    User.countDocuments(),
    User.countDocuments({ createdAt: { $gte: last30 } }),
    Product.countDocuments({ isActive: true }),
    // Real schema uses variants[].stock, not the old sneaker-era sizes[].stock.
    Product.countDocuments({
      isActive: true,
      $expr: { $eq: [{ $sum: "$variants.stock" }, 0] },
    }),
    Order.countDocuments({ status: "pending" }),
    Review.aggregate([{ $group: { _id: null, avg: { $avg: "$rating" } } }]),
  ]);

  return {
    totalOrders,
    pendingOrders,
    totalRevenue: totalRevenueAgg[0]?.total || 0,
    monthlyRevenue: monthlyRevenueAgg[0]?.total || 0,
    totalUsers,
    newUsersLast30: newUsers30,
    totalProducts,
    outOfStockProducts: outOfStock,
    avgRating: Math.round((avgRatingAgg[0]?.avg || 0) * 10) / 10,
  };
}

export async function getSalesSeries(days = 30) {
  const clamped = Math.min(365, Math.max(1, Number(days) || 30));
  const since = new Date(Date.now() - clamped * 24 * 60 * 60 * 1000);

  const series = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: since },
        status: { $in: REVENUE_STATUSES },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        revenue: { $sum: "$total" },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, date: "$_id", revenue: 1, orders: 1 } },
  ]);

  return { days: clamped, series };
}

export async function getTopProducts(limit = 10) {
  const clamped = Math.min(50, Number(limit) || 10);

  const products = await Order.aggregate([
    { $match: { status: { $in: REVENUE_STATUSES } } },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.product",
        // Real schema denormalizes name/image/price under items.snapshot,
        // not flat on the item — see models/orderModel.js.
        name: { $first: "$items.snapshot.name" },
        image: { $first: "$items.snapshot.image" },
        totalSold: { $sum: "$items.quantity" },
        revenue: { $sum: { $multiply: ["$items.snapshot.price", "$items.quantity"] } },
      },
    },
    { $sort: { totalSold: -1 } },
    { $limit: clamped },
  ]);

  return products;
}

export async function getStatusBreakdown() {
  return Order.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
    { $project: { _id: 0, status: "$_id", count: 1 } },
  ]);
}

export async function getRevenueByMethod() {
  return Order.aggregate([
    { $match: { status: { $in: REVENUE_STATUSES } } },
    {
      $lookup: {
        from: "payments",
        localField: "_id",
        foreignField: "order",
        as: "payment",
      },
    },
    { $unwind: { path: "$payment", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$payment.method",
        revenue: { $sum: "$total" },
        count: { $sum: 1 },
      },
    },
    { $project: { _id: 0, method: { $ifNull: ["$_id", "unknown"] }, revenue: 1, count: 1 } },
  ]);
}
