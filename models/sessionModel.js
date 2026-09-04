import mongoose from "mongoose";

// Opaque, server-side, revocable sessions — replaces the old non-revocable
// bearer JWT (see lib/session.js for the create/validate/revoke logic that
// owns this model; nothing else should query it directly).
//
// The raw session token and the raw CSRF token are never stored — only
// their SHA-256 hashes. Neither raw value is ever logged either (see
// lib/session.js's own comments). A stolen database dump therefore reveals
// no usable credential, only hashes that would need to be matched against
// a guessed 256-bit-entropy raw value to be worth anything.
const sessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      // Defense in depth: excluded from any normal find()/findOne() result
      // and from JSON/object serialization unless a query explicitly opts
      // in with .select("+tokenHash"). Nothing reads this field back after
      // using it as a query filter (see lib/session.js) — querying BY
      // tokenHash still works identically with select:false; only the
      // RETURNED document's field is affected.
      select: false,
    },
    csrfTokenHash: {
      type: String,
      required: true,
      // Same reasoning as tokenHash above. The one legitimate reader
      // (lib/csrf.js's verifyCsrfForSession) receives it because
      // lib/session.js's validateSessionToken() explicitly re-selects it.
      select: false,
    },
    expiresAt: {
      type: Date,
      required: true,
      // TTL index: MongoDB's background task removes the document once
      // this date has passed. This is a cleanup backstop only — every
      // authenticated request also explicitly checks `expiresAt` itself
      // (see lib/session.js's validateSessionToken), since the TTL sweep
      // runs on its own ~60s cycle and must never be the only thing
      // standing between an expired session and continued access.
      index: { expires: 0 },
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    // Optional, coarse, privacy-safe metadata for a future "your active
    // sessions" UI — never anything more identifying than this (no IP, no
    // full UA string retained beyond what's genuinely useful to show a
    // user which device a session belongs to).
    userAgent: {
      type: String,
      default: "",
      maxlength: 200,
    },
  },
  { timestamps: true },
);

// Supports revokeAllSessionsForUser() and any future "your active
// sessions" listing — both filter by user first, then by revokedAt/date.
sessionSchema.index({ user: 1, revokedAt: 1 });

// Guards against Next.js dev's hot-reload re-executing this module and
// trying to re-register an already-compiled model.
const Session = mongoose.models.sessions || mongoose.model("sessions", sessionSchema);
export default Session;
