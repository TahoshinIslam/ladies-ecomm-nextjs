import asyncHandler from "../middleware/asyncHandler.js";
import Brand from "../models/brandModel.js";

export const getBrands = asyncHandler(async (req, res) => {
  const brands = await Brand.find().sort("name");
  res.json({ success: true, count: brands.length, brands });
});

export const getBrand = asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.id);
  if (!brand) {
    res.status(404);
    throw new Error("Brand not found");
  }
  res.json({ success: true, brand });
});

export const createBrand = asyncHandler(async (req, res) => {
  const brand = await Brand.create(req.body);
  res.status(201).json({ success: true, brand });
});

export const updateBrand = asyncHandler(async (req, res) => {
  const brand = await Brand.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!brand) {
    res.status(404);
    throw new Error("Brand not found");
  }
  res.json({ success: true, brand });
});

export const deleteBrand = asyncHandler(async (req, res) => {
  const brand = await Brand.findByIdAndDelete(req.params.id);
  if (!brand) {
    res.status(404);
    throw new Error("Brand not found");
  }
  res.json({ success: true, message: "Brand deleted" });
});
