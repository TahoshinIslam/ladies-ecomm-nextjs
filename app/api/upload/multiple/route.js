import { NextResponse } from "next/server";

import { requireAdmin } from "../../../../lib/auth.js";
import { uploadMany } from "../../../../services/uploadService.js";
import { HttpError, withRoute } from "../../../../lib/http.js";

export const POST = withRoute(async (request) => {
  await requireAdmin(request);

  const formData = await request.formData();
  const files = formData.getAll("images").filter((f) => typeof f !== "string");
  if (!files.length) {
    throw new HttpError(400, "No files uploaded. The form field must be named 'images'.");
  }
  const folder = new URL(request.url).searchParams.get("folder") || "shoestore";

  const results = await uploadMany(files, folder);
  return NextResponse.json({ success: true, files: results }, { status: 201 });
});
