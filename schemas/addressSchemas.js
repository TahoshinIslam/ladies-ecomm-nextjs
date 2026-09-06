import { z } from "zod";

import { phoneSchema, requiredString } from "./commonSchemas.js";

// Shared by both address CRUD (this file) and order creation
// (orderSchemas.js's shippingAddressSchema extends this with no
// label/isDefault, since an order's shipping address is a point-in-time
// snapshot, not a saved address book entry).
// Mins are deliberately 1 (not a "realistic name/street length"), matching
// the existing regression suite's many single-character address fixtures
// (fullName/phone/street/city/postalCode: "x") — this schema's job is
// bounding type/length/emptiness, not judging whether a name "looks real",
// which is a UX concern for client-side form validation, not a security
// boundary.
export const shippingAddressFields = {
  fullName: requiredString({ min: 1, max: 100 }),
  phone: phoneSchema,
  street: requiredString({ min: 1, max: 200 }),
  city: requiredString({ min: 1, max: 100 }),
  state: z.string().trim().max(100).optional().default(""),
  postalCode: requiredString({ min: 1, max: 20 }),
  country: requiredString({ min: 1, max: 100 }),
};

// Exported standalone (not just inlined below) so client address forms
// (views/ProfilePage.jsx, views/CheckoutPage.jsx's new-address form) can
// reuse the exact same enum instead of hand-copying the three label
// strings and risking drift if a fourth is ever added here.
export const ADDRESS_LABELS = ["home", "work", "other"];

export const createAddressSchema = z
  .object({
    ...shippingAddressFields,
    label: z.enum(ADDRESS_LABELS).optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

export const updateAddressSchema = createAddressSchema.partial();
