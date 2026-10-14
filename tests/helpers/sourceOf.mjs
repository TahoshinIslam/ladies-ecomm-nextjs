// The source a static guard should scan for a module: the file itself plus
// every module it re-exports from (`export { … } from "./part.js"`).
//
// Several tests read a service's source as text to enforce a rule — every
// event emit is transactional or explicitly best-effort, no idempotency key is
// ever logged. When a large service is split into focused modules behind a
// re-exporting file (services/orderService.js → services/orders/*.js), reading
// only that file would scan nothing and pass vacuously. This follows the
// re-exports so the guard keeps checking the real code.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @param {string} rel path from the project root, e.g. "services/orderService.js" */
export function sourceOf(rel, seen = new Set()) {
  const file = path.resolve(root, rel);
  if (seen.has(file)) return "";
  seen.add(file);
  const src = fs.readFileSync(file, "utf8");
  const parts = [src];
  for (const m of src.matchAll(/^export\s+(?:\{[^}]*\}|\*)\s+from\s+["'](\.[^"']+)["']/gm)) {
    parts.push(sourceOf(path.relative(root, path.resolve(path.dirname(file), m[1])), seen));
  }
  return parts.join("\n");
}
