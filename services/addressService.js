import Address from "../models/addressModel.js";
import { HttpError } from "../lib/http.js";

const WRITABLE_FIELDS = ["label", "fullName", "phone", "street", "city", "state", "postalCode", "country", "isDefault"];

const pickWritable = (body) => {
  const out = {};
  for (const key of WRITABLE_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
};

export async function listAddresses(userId) {
  return Address.find({ user: userId }).sort("-isDefault -createdAt");
}

export async function createAddress(userId, body) {
  return Address.create({ ...pickWritable(body), user: userId });
}

export async function updateAddress(userId, addressId, body) {
  const address = await Address.findOne({ _id: addressId, user: userId });
  if (!address) throw new HttpError(404, "Address not found");
  Object.assign(address, pickWritable(body));
  await address.save();
  return address;
}

export async function deleteAddress(userId, addressId) {
  const address = await Address.findOneAndDelete({ _id: addressId, user: userId });
  if (!address) throw new HttpError(404, "Address not found");
}
