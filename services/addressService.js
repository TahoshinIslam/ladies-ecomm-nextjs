import Address from "../models/addressModel.js";
import { HttpError } from "../lib/http.js";
import { requireObjectIdFormat } from "../lib/validation.js";

const WRITABLE_FIELDS = ["label", "fullName", "phone", "street", "city", "state", "postalCode", "country", "isDefault"];

const pickWritable = (body) => {
  const out = {};
  for (const key of WRITABLE_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
};

export async function listAddresses(userId) {
  return Address.findByUser(userId);
}

export async function createAddress(userId, body) {
  return Address.create({ ...pickWritable(body), user: userId });
}

export async function updateAddress(userId, addressId, body) {
  requireObjectIdFormat(addressId, "addressId");
  const address = await Address.findByIdForUser(addressId, userId);
  if (!address) throw new HttpError(404, "Address not found");
  Object.assign(address, pickWritable(body));
  await address.save();
  return address;
}

export async function deleteAddress(userId, addressId) {
  requireObjectIdFormat(addressId, "addressId");
  const deleted = await Address.deleteForUser(addressId, userId);
  if (!deleted) throw new HttpError(404, "Address not found");
}
