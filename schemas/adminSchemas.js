import { z } from "zod";

import { paginationSchema, nonNegativeFiniteNumber, boundedIntParam } from "./commonSchemas.js";

// A theme color token — hex or oklch/hsl/rgb, kept permissive (this app
// doesn't enforce one specific color-string grammar) but bounded so it
// can't be an absurdly long string or a non-string value.
const colorToken = z.string().trim().min(1).max(100);

const colorPaletteSchema = z
  .object({
    primary: colorToken,
    primaryForeground: colorToken,
    accent: colorToken,
    accentForeground: colorToken,
    background: colorToken,
    foreground: colorToken,
    muted: colorToken,
    mutedForeground: colorToken,
    border: colorToken,
    success: colorToken,
    warning: colorToken,
    danger: colorToken,
  })
  .strict()
  .partial();

const themeFields = {
  name: z.string().trim().min(1).max(100),
  isActive: z.boolean(),
  colors: colorPaletteSchema,
  darkColors: colorPaletteSchema,
  fonts: z
    .object({ heading: z.string().trim().max(200), body: z.string().trim().max(200) })
    .strict()
    .partial(),
  radius: z.string().trim().max(30),
  shadowStyle: z.enum(["none", "soft", "medium", "hard"]),
  density: z.enum(["compact", "comfortable", "spacious"]),
  logoUrl: z.string().trim().max(2000),
  logoDarkUrl: z.string().trim().max(2000),
  faviconUrl: z.string().trim().max(2000),
  siteName: z.string().trim().max(200),
  tagline: z.string().trim().max(300),
  features: z
    .object({
      enableDarkMode: z.boolean(),
      enableAnimations: z.boolean(),
      enableWishlist: z.boolean(),
      enableCompare: z.boolean(),
      enableReviews: z.boolean(),
      enableCoupons: z.boolean(),
      announcementBar: z.string().trim().max(300),
    })
    .strict()
    .partial(),
};

export const createThemeSchema = z.object(themeFields).partial().strict();
export const updateThemeSchema = z
  .object(themeFields)
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field must be provided" });

// ====== Settings ======

const taxRuleSchema = z
  .object({
    region: z.string().trim().min(1).max(20),
    label: z.string().trim().max(100).optional().default("Tax"),
    rate: z.number().min(0).max(1),
    inclusive: z.boolean().optional().default(false),
  })
  .strict();

const shippingTierSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    baseCost: nonNegativeFiniteNumber,
    freeAbove: nonNegativeFiniteNumber.optional().default(0),
  })
  .strict();

const shippingZoneSchema = z
  .object({
    region: z.string().trim().min(1).max(20),
    currency: z.enum(["BDT", "USD"]),
    tiers: z.array(shippingTierSchema).max(20).optional().default([]),
  })
  .strict();

export const updateSettingsSchema = z
  .object({
    store: z
      .object({
        name: z.string().trim().max(200),
        supportEmail: z.union([z.literal(""), z.string().trim().email()]),
        supportPhone: z.string().trim().max(30),
        logoUrl: z.string().trim().max(2000),
        logoDarkUrl: z.string().trim().max(2000),
        faviconUrl: z.string().trim().max(2000),
      })
      .strict()
      .partial(),
    homepage: z
      .object({
        carouselImages: z
          .object({
            burqa: z.string().trim().max(2000),
            abaya: z.string().trim().max(2000),
            hijab: z.string().trim().max(2000),
          })
          .strict()
          .partial(),
        banner: z
          .object({
            enabled: z.boolean(),
            imageUrl: z.string().trim().max(2000),
            href: z.string().trim().max(500),
          })
          .strict()
          .partial(),
        campaign: z
          .object({
            enabled: z.boolean(),
            title: z.string().trim().max(200),
            message: z.string().trim().max(500),
            ctaLabel: z.string().trim().max(100),
            ctaHref: z.string().trim().max(500),
          })
          .strict()
          .partial(),
      })
      .strict()
      .partial(),
    currency: z
      .object({
        defaultDisplay: z.enum(["BDT", "USD"]),
        usdToBdt: z.number().min(1).max(100000),
      })
      .strict()
      .partial(),
    promotions: z.object({ firstOrderFreeShipping: z.boolean() }).strict().partial(),
    exchangePolicy: z
      .object({
        windowDays: z.number().int().min(0).max(3650),
        description: z.string().trim().max(300),
      })
      .strict()
      .partial(),
    taxRules: z.array(taxRuleSchema).max(20),
    shippingZones: z.array(shippingZoneSchema).max(20),
  })
  .strict()
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field must be provided" });

// ====== Analytics/reporting range bounds ======

export const salesSeriesQuerySchema = z.object({
  days: boundedIntParam({ min: 1, max: 365, defaultValue: 30 }),
});

export const topProductsQuerySchema = z.object({
  limit: boundedIntParam({ min: 1, max: 50, defaultValue: 5 }),
});

// GET /api/notifications — Phase 5 fix for the confirmed unclamped
// `limit` (services/notificationService.js's getNotifications() passed
// `Number(limit)` straight into `.limit()`).
export const notificationsQuerySchema = z
  .object({
    unreadOnly: z.enum(["true", "false"]).optional(),
  })
  .extend(paginationSchema({ maxLimit: 100, defaultLimit: 20 }).shape)
  .strict();
