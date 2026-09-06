import { NextResponse } from "next/server";

import { requireAdmin } from "../../../../lib/auth.js";
import { uploadMany } from "../../../../services/uploadService.js";
import { HttpError, withRoute } from "../../../../lib/http.js";
import { requireSafeFolder } from "../../../../lib/validation.js";

export const POST = withRoute(async (request) => {
  await requireAdmin(request);

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new HttpError(415, "Content-Type must be multipart/form-data");
  }
  const formData = await request.formData();
  const files = formData.getAll("images").filter((f) => typeof f !== "string");
  if (!files.length) {
    throw new HttpError(400, "No files uploaded. The form field must be named 'images'.");
  }
  const folder = requireSafeFolder(new URL(request.url).searchParams.get("folder"));

  const results = await uploadMany(files, folder);
  return NextResponse.json({ success: true, files: results }, { status: 201 });
});
