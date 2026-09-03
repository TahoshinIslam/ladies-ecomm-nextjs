import jwt from "jsonwebtoken";

import User from "../models/userModel.js";
import { HttpError } from "./http.js";

// Bearer-token auth only — store/apiSlice.js sends `Authorization: Bearer
// <token>` on every request (token lives in localStorage via authSlice.js).
// No cookie handling: this app was originally split across a Vercel
// frontend / Render backend where third-party cookies get blocked, so
// bearer tokens were the deliberate choice (see utlis/generateToken.js).
export async function getSessionUser(request) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findById(decoded.id);
  return user || null;
}

export async function requireAdmin(request) {
  const user = await getSessionUser(request);
  if (!user) throw new HttpError(401, "Not authorized, no token");
  if (user.role !== "admin") throw new HttpError(403, "Admin access only");
  return user;
}
