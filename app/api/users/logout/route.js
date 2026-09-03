import { NextResponse } from "next/server";

// Bearer-token auth has no server-side session to clear — the client just
// discards its stored token. This exists so the frontend's logout mutation
// (store/userApi.js) has a real endpoint to call instead of a 501.
export async function POST() {
  return NextResponse.json({ success: true, message: "Logged out" });
}
