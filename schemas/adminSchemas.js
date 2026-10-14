import { z } from "../lib/zod.js";

import { paginationSchema } from "./commonSchemas.js";

// GET /api/notifications — `limit` is clamped so the list query is
// always bounded.
export const notificationsQuerySchema = z
  .object({
    unreadOnly: z.enum(["true", "false"]).optional(),
  })
  .extend(paginationSchema({ maxLimit: 100, defaultLimit: 20 }).shape)
  .strict();
