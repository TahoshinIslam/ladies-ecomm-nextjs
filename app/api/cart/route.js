import { NextResponse } from "next/server";

// Signed-out visitors use the localStorage guest cart (store/guestCartSlice.js).
// A server cart needs the session middleware from the backend phase, so this
// returns an empty cart rather than a 500 that would break the drawer.
export async function GET() {
  return NextResponse.json({ cart: { items: [] } });
}
