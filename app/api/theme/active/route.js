import { NextResponse } from "next/server";

// No admin theme is published yet, so the storefront keeps the design tokens
// defined in app/globals.css. Returning null here is a valid state, not an
// error — ThemeProvider treats it as "use the stylesheet defaults".
export async function GET() {
  return NextResponse.json({ theme: null });
}
