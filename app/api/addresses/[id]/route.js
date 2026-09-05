import { NextResponse } from "next/server";

import { requireUser } from "../../../../lib/auth.js";
import { updateAddress, deleteAddress } from "../../../../services/addressService.js";
import { withRoute } from "../../../../lib/http.js";
import { parseJsonBody } from "../../../../lib/validation.js";
import { updateAddressSchema } from "../../../../schemas/addressSchemas.js";

export const PUT = withRoute(async (request, { params }) => {
  const user = await requireUser(request);
  const { id } = await params;
  const body = await parseJsonBody(request, updateAddressSchema);
  const address = await updateAddress(user._id, id, body);
  return NextResponse.json({ success: true, address });
});

export const DELETE = withRoute(async (request, { params }) => {
  const user = await requireUser(request);
  const { id } = await params;
  await deleteAddress(user._id, id);
  return NextResponse.json({ success: true, message: "Address deleted" });
});
