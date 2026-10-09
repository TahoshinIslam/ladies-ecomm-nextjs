import { query } from "../../../config/db.js";
import { getOrganizationId } from "../../../lib/tenant.js";

/**
 * Serves an image the shop owner uploaded from the admin dashboard.
 *
 * Product photos, promotion banners, the store logo and theme assets are
 * stored in the shared database's `files` table rather than on a CDN, so a
 * `/files/<id>` URL saved by the dashboard has to resolve on this app too —
 * the dashboard's own route is on a different origin, and a shopper has no
 * session there. This is that route.
 *
 * Two conditions, both required:
 *
 *   - the file's `purpose` is one of the storefront media kinds. Those are
 *     set by the dashboard's upload action, never by form input, so this
 *     cannot be pointed at a staff avatar or any other private upload.
 *   - the file belongs to this store. A shopper browsing one shop must not
 *     be able to read another shop's media out of the shared table by
 *     guessing an id, so an id belonging to someone else returns exactly the
 *     404 an unknown id returns.
 *
 * No session is required: these images are public by nature — they are what
 * the shop is showing the world.
 */
const PUBLIC_PURPOSES = ["product", "promotion", "theme", "store"];

export async function GET(_request, { params }) {
  const { id } = await params;

  const rows = await query(
    `SELECT id, mime_type, size_bytes, chunked, data
       FROM files
      WHERE id = ?
        AND organization_id = ?
        AND purpose IN (${PUBLIC_PURPOSES.map(() => "?").join(", ")})
      LIMIT 1`,
    [id, getOrganizationId(), ...PUBLIC_PURPOSES],
  );

  const file = rows[0];
  if (!file) return new Response("Not found", { status: 404 });

  // A picture bigger than half a megabyte is stored as numbered pieces (see the dashboard's migration 117); join them in order.
  let bytes = file.data;
  if (Number(file.chunked)) {
    const pieces = await query("SELECT data FROM file_chunks WHERE file_id = ? ORDER BY seq", [file.id]);
    bytes = Buffer.concat(pieces.map((p) => p.data));
  }

  return new Response(bytes, {
    headers: {
      "Content-Type": file.mime_type,
      "Content-Length": String(file.size_bytes),
      // Replacing an image stores a new row under a new id, so a given id's
      // bytes never change and can be cached hard.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
