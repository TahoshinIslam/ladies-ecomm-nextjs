import { NextResponse } from "next/server";

import { requireUser } from "../../../lib/auth.js";
import { listAddresses, createAddress } from "../../../services/addressService.js";
import { withRoute } from "../../../lib/http.js";
import { parseJsonBody } from "../../../lib/validation.js";
import { createAddressSchema } from "../../../schemas/addressSchemas.js";

export const GET = withRoute(async (request) => {
  const user = await requireUser(request);
  const addresses = await listAddresses(user._id);
  return NextResponse.json({ success: true, count: addresses.length, addresses });
});

export const POST = withRoute(async (request) => {
  const user = await requireUser(request);
  const body = await parseJsonBody(request, createAddressSchema);
  const address = await createAddress(user._id, body);
  return NextResponse.json({ success: true, address }, { status: 201 });
});
