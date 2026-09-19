import { z } from "zod";

import { MAX_BOX, MAX_ZOOM, MIN_ZOOM, sanitizeFraming } from "../lib/imageFraming.js";

// One shared validator for a saved image framing (lib/imageFraming.js):
// strict shape, then re-normalized through sanitizeFraming() so what is
// stored is always canonical (clamped, rounded, version-stamped) no matter
// which client sent it.
export const framingSchema = z
  .object({
    v: z.literal(1).optional(),
    mode: z.enum(["fill", "fit", "free"]),
    zoom: z.number().min(MIN_ZOOM).max(MAX_ZOOM),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().int().positive().max(50000),
    h: z.number().int().positive().max(50000),
    // "free" (stretch) mode only: where the image sits, as fractions of the frame.
    bx: z.number().min(-MAX_BOX).max(1).optional(),
    by: z.number().min(-MAX_BOX).max(1).optional(),
    bw: z.number().positive().max(MAX_BOX).optional(),
    bh: z.number().positive().max(MAX_BOX).optional(),
  })
  .strict()
  .refine(
    (v) => (v.mode === "free" ? [v.bx, v.by, v.bw, v.bh].every((n) => n !== undefined) : [v.bx, v.by, v.bw, v.bh].every((n) => n === undefined)),
    "stretch framing needs bx, by, bw and bh — and only stretch framing has them",
  )
  .transform((value) => sanitizeFraming(value));

/** For optional per-slot framing fields: omitted = leave as is, null = clear. */
export const optionalFramingSchema = framingSchema.nullable().optional();

// Homepage slots are keyed "<placement>" or "<placement>:<slug>" with the
// placement's "." written as "_" — e.g. "banner_home", "department_tile:burqa"
// (lib/imageFraming.js homepageFramingKey). Object KEYS may never contain "."
// (lib/validation.js's assertNoOperatorInjection), hence the underscore.
export const homepageFramingMapSchema = z
  .record(z.string().regex(/^[a-z]+_[a-z]+(:[a-z0-9-]{1,40})?$/), framingSchema)
  .refine((map) => Object.keys(map).length <= 60, "too many framings");

// Product photos: a LIST of { url, framing } (a URL can't be an object key —
// see parseFramingListColumn in lib/imageFraming.js).
export const productFramingListSchema = z
  .array(z.object({ url: z.string().trim().min(1).max(2000), framing: framingSchema }).strict())
  .max(100);
