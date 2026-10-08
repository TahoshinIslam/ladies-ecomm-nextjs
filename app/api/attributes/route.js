import { NextResponse } from "next/server";

import { withRoute } from "../../../lib/http.js";
import { getServerLocale } from "../../../lib/i18n/server.js";
import { localizeAttributeDefinitionList } from "../../../lib/i18n/localize.js";
import { requireObjectIdFormat } from "../../../lib/validation.js";

import { getCachedAllAttributes, getCachedAttributesForCategory } from "../../../lib/serverDataCache.js";

// GET /api/attributes           -> full raw list (Attributes admin page —
//                                   never localized, the admin form needs
//                                   both label/labelBn to edit them)
// GET /api/attributes?category= -> filtered + label-resolved for that
//                                   top-level category id. Two real
//                                   consumers share this: the admin
//                                   product form's Step 2 (needs raw
//                                   English labels to edit reliably) and
//                                   the storefront filter panel/PDP (needs
//                                   the locale-resolved label). Admin
//                                   requests are detected the same way as
//                                   app/api/products/route.js and always
//                                   get the raw, unlocalized list — see
//                                   that file's comment for why silently
//                                   localizing here would risk an admin
//                                   re-saving labelBn over the real label.
export const GET = withRoute(async (request) => {
  const category = new URL(request.url).searchParams.get("category");
  if (!category) {
    const attributes = await getCachedAllAttributes();
    return NextResponse.json({ attributes });
  }
  requireObjectIdFormat(category, "category");
  const [attributes, locale] = await Promise.all([
    getCachedAttributesForCategory(category),
    getServerLocale(),
  ]);
  return NextResponse.json({
    attributes: localizeAttributeDefinitionList(attributes, locale),
  });
});

// The staff-gated handler that used to live here (POST) went with the
// admin section: creating and editing the catalog is the dashboard's job now,
// and it writes an audit trail this app never did. The public handler above
// remains what the storefront actually needs.
