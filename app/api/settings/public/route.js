import { NextResponse } from "next/server";

// Public storefront settings. Mirrors the shape of models/settingsModel.js so
// SettingsContext can consume it unchanged once the admin panel writes here.
export async function GET() {
  return NextResponse.json({
    settings: {
      store: {
        name: "TAHOS.",
        tagline: "Footwear for wherever the day goes next.",
        logoUrl: "",
        logoDarkUrl: "",
      },
      currency: { defaultDisplay: "USD", usdToBdt: 120 },
      shippingZones: [
        { region: "US", currency: "USD", freeAbove: 200, flatRate: 12 },
      ],
      taxRules: [],
    },
  });
}
