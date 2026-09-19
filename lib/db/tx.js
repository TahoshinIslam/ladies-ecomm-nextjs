import { withTransaction } from "./transaction.js";

// `withTransaction` lives in ./transaction.js (dependency-free, so models can use it
// from plain-Node scripts); re-exported here so every existing caller is unchanged.
export { withTransaction };

// Duplicate-key detection lives in lib/idempotency.js's isDuplicateKeyError()
// — reused as-is here (it's already MySQL-shaped, not Mongo-specific)
// rather than duplicated.
export { isDuplicateKeyError } from "../idempotency.js";
