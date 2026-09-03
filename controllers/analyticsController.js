import asyncHandler from "../middleware/asyncHandler.js";
import Order from "../models/orderModel.js";
import User from "../models/userModel.js";
import Product from "../models/productModel.js";
import Review from "../models/reviewModel.js";

// @desc    Top-level dashboard KPI numbers
// @route   GET /api/analytics/overview
// @access  Admin
export const getOverview = asyncHandler(async (req, res) => {
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
      { $match: { status: { $in: ["paid", "processing", "shipped", "delivered"] } } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    Order.aggregate([
      {
        $match: {
          status: { $in: ["paid", "processing", "shipped", "delivered"] },
          createdAt: { $gte: startOfMonth },
        },
      },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    User.countDocuments(),
    User.countDocuments({ createdAt: { $gte: last30 } }),
    Product.countDocuments({ isActive: true }),
    Product.countDocuments({
      isActive: true,
      $expr: { $eq: [{ $sum: "$sizes.stock" }, 0] },
    }),
    Order.countDocuments({ status: "pending" }),
    Review.aggregate([{ $group: { _id: null, avg: { $avg: "$rating" } } }]),
  ]);

  res.json({
    success: true,
    overview: {
      totalOrders,
      pendingOrders,
      totalRevenue: totalRevenueAgg[0]?.total || 0,
      monthlyRevenue: monthlyRevenueAgg[0]?.total || 0,
      totalUsers,
      newUsersLast30: newUsers30,
      totalProducts,
      outOfStockProducts: outOfStock,
      avgRating: Math.round((avgRatingAgg[0]?.avg || 0) * 10) / 10,
    },
  });
});

// @desc    Sales by day for last N days (default 30)
// @route   GET /api/analytics/sales-series?days=30
// @access  Admin
export const getSalesSeries = asyncHandler(async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const data = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: since },
        status: { $in: ["paid", "processing", "shipped", "delivered"] },
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

  res.json({ success: true, days, series: data });
});

// @desc    Top-selling products (by quantity sold)
// @route   GET /api/analytics/top-products?limit=10
// @access  Admin
export const getTopProducts = asyncHandler(async (req, res) => {
  const limit = Math.min(50, Number(req.query.limit) || 10);

  const data = await Order.aggregate([
    { $match: { status: { $in: ["paid", "processing", "shipped", "delivered"] } } },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.product",
        name: { $first: "$items.name" },
        image: { $first: "$items.image" },
        totalSold: { $sum: "$items.quantity" },
        revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
      },
    },
    { $sort: { totalSold: -1 } },
    { $limit: limit },
  ]);

  res.json({ success: true, count: data.length, products: data });
});

// @desc    Order status breakdown (for pie chart)
// @route   GET /api/analytics/status-breakdown
// @access  Admin
export const getStatusBreakdown = asyncHandler(async (req, res) => {
  const data = await Order.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
    { $project: { _id: 0, status: "$_id", count: 1 } },
  ]);
  res.json({ success: true, data });
});

// @desc    Revenue by payment method
// @route   GET /api/analytics/revenue-by-method
// @access  Admin
export const getRevenueByMethod = asyncHandler(async (req, res) => {
  const data = await Order.aggregate([
    { $match: { status: { $in: ["paid", "processing", "shipped", "delivered"] } } },
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
  res.json({ success: true, data });
});
