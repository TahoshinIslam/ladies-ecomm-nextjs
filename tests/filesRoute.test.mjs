// Uploads live in the database and are served at /files/<id>. A picture larger than one piece is stored as numbered rows in
// `file_chunks` (the dashboard's migration 117) so a database server with a small max_allowed_packet can still hold it; this serves
// both kinds, and only the public media purposes of this store.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, rawQuery } from "./helpers/testDb.mjs";

const ORG = process.env.STORE_ORGANIZATION_ID;
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("GET /files/:id", { skip: !dbReady && skipReason }, () => {
  let GET;
  const ids = [];
  const big = Buffer.concat([PNG_HEAD, crypto.randomBytes(1_300_000)]);
  const small = Buffer.concat([PNG_HEAD, crypto.randomBytes(2_000)]);

  const put = async ({ id, purpose = "product", org = ORG, bytes, chunked }) => {
    ids.push(id);
    await rawQuery(
      "INSERT INTO files (id, organization_id, purpose, filename, mime_type, size_bytes, chunked, data) VALUES (?, ?, ?, 'x.png', 'image/png', ?, ?, ?)",
      [id, org, purpose, bytes.length, chunked ? 1 : 0, chunked ? Buffer.alloc(0) : bytes],
    );
    if (chunked) {
      const piece = 200 * 1024; // small enough for this helper's text-protocol inserts under a 1 MB packet limit
      for (let seq = 0, off = 0; off < bytes.length; seq += 1, off += piece) {
        await rawQuery("INSERT INTO file_chunks (file_id, seq, data) VALUES (?, ?, ?)", [id, seq, bytes.subarray(off, off + piece)]);
      }
    }
  };
  const get = async (id) => GET(new Request(`http://test/files/${id}`), { params: Promise.resolve({ id }) });

  before(async () => {
    await connectTestDb();
    ({ GET } = await import("../app/files/[id]/route.js"));
    const run = crypto.randomBytes(3).toString("hex");
    await put({ id: `fil_t_small_${run}`, bytes: small, chunked: false });
    await put({ id: `fil_t_big_${run}`, bytes: big, chunked: true });
    await put({ id: `fil_t_priv_${run}`, bytes: small, chunked: false, purpose: "avatar" });
    await put({ id: `fil_t_other_${run}`, bytes: small, chunked: false, org: "ORG-someone-else" }).catch(() => ids.pop());
    ids.run = run;
  });

  after(async () => {
    for (const id of ids) await rawQuery("DELETE FROM files WHERE id = ?", [id]);
    await disconnectTestDb();
  });

  test("a small picture is served as stored", async () => {
    const res = await get(`fil_t_small_${ids.run}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(small));
  });

  test("a picture stored in pieces comes back byte for byte, in the right order, with the right length", async () => {
    const res = await get(`fil_t_big_${ids.run}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-length"), String(big.length));
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(big));
  });

  test("a file whose purpose is not public media (an avatar) is a 404, like an unknown id", async () => {
    assert.equal((await get(`fil_t_priv_${ids.run}`)).status, 404);
    assert.equal((await get("fil_does_not_exist")).status, 404);
  });
});
