// Which store supplies this storefront, as a cache-key fragment.
//
// The admin dashboard owns the choice (Settings → Online Storefront: a row in
// the shared database, not an environment variable) and bumps a version number
// whenever the source or its assortment changes. The cached catalog reads below
// put this fragment in their keys, so the first request after a change misses
// and reads fresh data — no restart, no rebuild, and no call from one app to the
// other to purge anything. Scoped to this deployment's organization (one
// deployment serves one organization, see lib/tenant.js) and to the selected
// store, so another store's entries can never be served.
//
// The cost is one primary-key lookup per cached read. That is deliberate: a
// cache that keeps showing the old store after the admin switched is the bug
// this exists to prevent.
import connectDB from "../config/db.js";
import { getOnlineSource } from "../models/inventoryModel.js";
import { getOrganizationId } from "./tenant.js";

export async function onlineSourceKey() {
  await connectDB();
  const source = await getOnlineSource();
  return `${getOrganizationId()}:${source.locationId ?? "none"}:${source.version}`;
}
