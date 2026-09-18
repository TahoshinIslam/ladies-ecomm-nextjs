# `models/` after the MySQL migration

Every file in this directory used to export a Mongoose model. They now
export a plain object of async functions backed by `mysql2/promise` (see
`config/db.js`, `sql/schema.sql`). The convention every file follows:

- Field names on returned objects are unchanged from the old Mongoose
  document shape (`_id`, `createdAt`, `firstOrderPromoUsed`, ...) — only
  the SQL columns underneath are snake_case. This keeps services/routes/
  views that just *read* a document's fields working with little or no
  change; only the query call sites (`Model.find(...)`, `.populate()`,
  `.lean()`, chained builders) had to change shape.
- `_id` is a plain 24-hex-char string (see `lib/objectId.js`), not a class
  instance — `.toString()` on a string is a no-op, so existing
  `doc._id.toString()` call sites keep working unchanged.
- A single-row result (from `findById`/`findOne`/`create`) gets bound
  instance methods (`.save()`, `.deleteOne()`, and any model-specific ones
  like `.matchPassword()`) attached as plain function properties — `JSON`
  serialization (`NextResponse.json(doc)`) already skips function-valued
  properties, so nothing extra needs stripping before a document reaches a
  response.
- List/filter functions (`find`, `findOne`, `countDocuments`, ...) take a
  plain filter object and an options object (`{ select, sort, skip, limit
  }`) instead of a chainable query builder — every call site that used to
  chain `.select().sort().skip().limit().lean()` was rewritten to pass
  these as arguments instead.
- A Mongo `$in`/`$or`/`$gt`/etc. filter shape is only supported for the
  exact shapes each model's real call sites actually use — these are NOT
  general-purpose Mongo-query-to-SQL translators, deliberately: each
  `buildWhere()`/`find()` only implements what the corresponding service
  file needs, and throws on anything else, so an unsupported filter fails
  loudly at the call site instead of silently doing the wrong thing.
- A MongoDB transaction (`session.startSession()` / `session.withTransaction()`)
  is replaced by `lib/db/tx.js`'s `withTransaction(fn)`, which hands `fn` a
  raw `mysql2` `PoolConnection`. Model functions that need to participate in
  a transaction take that connection as an explicit last argument (see
  `models/productModel.js`'s stock-decrement, `models/couponModel.js`'s
  usage-claim, `models/orderModel.js`'s `create`) rather than a Mongoose
  `{ session }` option.
