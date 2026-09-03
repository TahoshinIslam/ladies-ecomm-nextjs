import { NextResponse } from "next/server";

import Brand from "../../../models/brandModel.js";
import { withRoute } from "../../../lib/http.js";

export const GET = withRoute(async () => {
  const brands = await Brand.find({ isActive: true }).sort("name");
  return NextResponse.json({ brands });
});
