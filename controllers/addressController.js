import asyncHandler from "../middleware/asyncHandler.js";
import Address from "../models/addressModel.js";

export const getMyAddresses = asyncHandler(async (req, res) => {
  const addresses = await Address.find({ user: req.user._id }).sort("-isDefault -createdAt");
  res.json({ success: true, count: addresses.length, addresses });
});

export const getAddress = asyncHandler(async (req, res) => {
  const address = await Address.findOne({ _id: req.params.id, user: req.user._id });
  if (!address) {
    res.status(404);
    throw new Error("Address not found");
  }
  res.json({ success: true, address });
});

export const createAddress = asyncHandler(async (req, res) => {
  const address = await Address.create({ ...req.body, user: req.user._id });
  res.status(201).json({ success: true, address });
});

export const updateAddress = asyncHandler(async (req, res) => {
  const address = await Address.findOne({ _id: req.params.id, user: req.user._id });
  if (!address) {
    res.status(404);
    throw new Error("Address not found");
  }
  Object.assign(address, req.body);
  await address.save();
  res.json({ success: true, address });
});

export const deleteAddress = asyncHandler(async (req, res) => {
  const address = await Address.findOneAndDelete({
    _id: req.params.id,
    user: req.user._id,
  });
  if (!address) {
    res.status(404);
    throw new Error("Address not found");
  }
  res.json({ success: true, message: "Address deleted" });
});
