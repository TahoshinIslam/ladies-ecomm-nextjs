import { NextResponse } from "next/server";

import { requireAdmin } from "../../../lib/auth.js";
import { uploadSingle } from "../../../services/uploadService.js";
import { HttpError, withRoute } from "../../../lib/http.js";
import { requireSafeFolder } from "../../../lib/validation.js";

export const POST = withRoute(async (request) => {
  await requireAdmin(request);

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new HttpError(415, "Content-Type must be multipart/form-data");
  }
  const formData = await request.formData();
  const file = formData.get("image");
  if (!file || typeof file === "string") {
    throw new HttpError(400, "No file uploaded. The form field must be named 'image'.");
  }
  const folder = requireSafeFolder(new URL(request.url).searchParams.get("folder"));

  const result = await uploadSingle(file, folder);
  return NextResponse.json({ success: true, ...result }, { status: 201 });
});
