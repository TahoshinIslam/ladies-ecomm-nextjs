// Creates the "Women"/"Men" gender-division top-level categories and
// reparents the 9 original fashion departments (Burqa, Hijab, Niqab,
// Abaya, Khimar, Modest Sets under Women; T-Shirt, Shirts, Jeans under
// Men) underneath them — the data-side half of a restructuring whose
// frontend code (CategoryMegaMenu.jsx, CategoryDrillMenu.jsx,
// storefrontDepartments.js, ShopPage.jsx, MobileCategoryDrawer.jsx) already
// assumed this shape. Also assigns each of the 9 departments its own real
// icon (previously unset, always falling back to a generic grid icon).
//
// Women vs Men grouping: Burqa/Hijab/Niqab/Abaya/Khimar/Modest Sets are
// unambiguously women's Islamic modest wear (only women wear a
// hijab/niqab/abaya/burqa/khimar) — there is no ambiguity there. T-Shirt/
// Shirts/Jeans are gender-neutral basics with no gender signal anywhere in
// their product data (checked: no product name/field indicates a gender),
// so they're filed under Men here mainly so Men isn't an empty shell —
// reparent them under Women instead (or split further) if that doesn't
// match your actual catalog intent; it's a single `parent` field per
// category, trivially changed later via the admin category editor.
//
// Safe to re-run: every write is upsert-by-slug (matches
// scripts/seedCatalog.mjs's own convention) — creating Women/Men is a
// no-op if they already exist, and reparenting a department that already
// has the right parent+icon just rewrites it to the same values.
//
// Usage: node --env-file=.env scripts/seedMenWomenDivisions.mjs

import connectDB, { closePool } from "../config/db.js";
import Category from "../models/categoryModel.js";

const DIVISIONS = [
  { slug: "women", name: "Women", icon: "venus", sortOrder: 0 },
  { slug: "men", name: "Men", icon: "mars", sortOrder: 1 },
];

// slug -> { division slug, icon }
const DEPARTMENTS = {
  burqa: { division: "women", icon: "person-standing" },
  hijab: { division: "women", icon: "wind" },
  niqab: { division: "women", icon: "venetian-mask" },
  abaya: { division: "women", icon: "layers" },
  khimar: { division: "women", icon: "layers-3" },
  "modest-sets": { division: "women", icon: "package" },
  "t-shirt": { division: "men", icon: "shirt" },
  shirts: { division: "men", icon: "layers-2" },
  jeans: { division: "men", icon: "square-split-vertical" },
};

async function upsertDivision({ slug, name, icon, sortOrder }) {
  const existing = await Category.findBySlug(slug);
  if (existing) {
    existing.icon = icon;
    existing.sortOrder = sortOrder;
    await existing.save();
    console.log(`  = ${name} (${existing._id}) already exists — icon/sortOrder refreshed`);
    return existing;
  }
  const created = await Category.create({ name, slug, icon, parent: null, sortOrder });
  console.log(`  + created ${name} (${created._id})`);
  return created;
}

async function main() {
  await connectDB();

  console.log("Divisions:");
  const divisionBySlug = {};
  for (const d of DIVISIONS) {
    divisionBySlug[d.slug] = await upsertDivision(d);
  }

  console.log("Departments:");
  for (const [slug, { division, icon }] of Object.entries(DEPARTMENTS)) {
    const dept = await Category.findBySlug(slug);
    if (!dept) {
      console.log(`  ! skipped "${slug}" — no category with this slug exists`);
      continue;
    }
    const parentId = divisionBySlug[division]._id;
    dept.parent = parentId;
    dept.icon = icon;
    await dept.save();
    console.log(`  = ${dept.name} -> parent ${division} (${parentId}), icon "${icon}"`);
  }

  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
