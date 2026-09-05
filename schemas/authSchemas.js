import { z } from "zod";

import { emailSchema, phoneSchema, requiredString, paginationSchema, searchQuerySchema, sortFieldSchema, sortOrderSchema } from "./commonSchemas.js";
import { PERMISSIONS } from "../lib/permissions.js";

// Exported as plain numbers (not just baked into passwordSchema below) so
// client forms can build their OWN zod object — with their own translated
// (`t("auth.passwordMinLength")`-style) messages — from the exact same
// boundary values, instead of hand-copying "8" and "72" and silently
// drifting out of sync with the server (this is precisely how they'd
// drifted: the client previously required only 6, while the server always
// required 8 — a password that passed client-side validation could still
// be rejected by the server with a generic error). See views/RegisterPage.jsx.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
export const NAME_MAX_LENGTH = 100;

// Bounded on both ends: a real password has to be typeable, and an
// unbounded max would let a client hand bcrypt/argon2 (whichever this app
// uses under the hood) a multi-megabyte string to hash, a cheap DoS lever
// against the login/register CPU budget.
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, "password must be at least 8 characters")
  .max(PASSWORD_MAX_LENGTH, "password must be at most 72 characters");

export const registerSchema = z
  .object({
    // min:1 (not a "realistic name length") — matches this app's existing
    // regression suite convention of minimal single-character test
    // fixtures (see schemas/addressSchemas.js's identical reasoning); name
    // length isn't a security boundary, just a bound against an empty or
    // absurdly long value.
    name: requiredString({ min: 1, max: 100 }),
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    // Deliberately NOT `passwordSchema` here — a login attempt with a
    // too-short/too-long password must still reach the real
    // constant-time comparison / dummy-hash timing-defense path (see
    // services/authService.js) and fail as "invalid credentials", not
    // leak "your password doesn't meet our format rules" as a distinct
    // response shape before that path even runs.
    password: z.string().min(1, "password is required").max(1000),
  })
  .strict();

export const forgotPasswordSchema = z.object({ email: emailSchema }).strict();

export const resetPasswordSchema = z.object({ password: passwordSchema }).strict();

// PUT /api/users/me — self-service profile update. `.strict()` here is a
// deliberate mass-assignment guard: this schema names every field a user
// may set on their OWN account, and nothing else (role, permissions,
// isVerified, etc. are all admin-only, see adminSchemas.js's
// updateUserAdminSchema instead) — an unknown field is now a 400, not
// silently ignored the way services/userService.js's own destructuring
// already made it (this schema formalizes that as an explicit, enforced
// contract rather than an implicit side effect of which fields the
// service happens to read).
export const updateMeSchema = z
  .object({
    name: requiredString({ min: 1, max: 100 }).optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    avatar: z.union([z.literal(""), z.string().trim().url()]).optional(),
    currentPassword: z.string().min(1).max(1000).optional(),
    newPassword: passwordSchema.optional(),
  })
  .strict();

// PUT /api/users/[id] — admin managing another user. Mirrors
// services/userService.js's ADMIN_USER_WRITABLE_FIELDS exactly; `.strict()`
// so a caller can never write any other model field this way.
// `permissions` is checked against the SAME `PERMISSIONS` constant lib/auth.js
// itself enforces — an unknown permission string is now a clean 400 here
// instead of surfacing only as a service-level error deep inside
// updateUser().
export const updateUserAdminSchema = z
  .object({
    name: requiredString({ min: 1, max: 100 }).optional(),
    email: emailSchema.optional(),
    role: z.enum(["customer", "employee", "admin"]).optional(),
    isVerified: z.boolean().optional(),
    permissions: z.array(z.enum(Object.values(PERMISSIONS))).max(50).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field must be provided" });

// GET /api/users (admin list)
export const adminUserListQuerySchema = z
  .object({
    role: z.enum(["customer", "employee", "admin"]).optional(),
    search: searchQuerySchema,
    sortBy: sortFieldSchema(["name", "email", "role", "createdAt"], "createdAt"),
    sortOrder: sortOrderSchema,
  })
  .extend(paginationSchema().shape)
  .strict();
