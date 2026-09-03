import { NextResponse } from "next/server";

import { requireAdmin } from "../../../lib/auth.js";
import { uploadSingle } from "../../../services/uploadService.js";
import { HttpError, withRoute } from "../../../lib/http.js";

export const POST = withRoute(async (request) => {
  await requireAdmin(request);

  const formData = await request.formData();
  const file = formData.get("image");
  if (!file || typeof file === "string") {
    throw new HttpError(400, "No file uploaded. The form field must be named 'image'.");
  }
  const folder = new URL(request.url).searchParams.get("folder") || "shoestore";

  const result = await uploadSingle(file, folder);
  return NextResponse.json({ success: true, ...result }, { status: 201 });
});
