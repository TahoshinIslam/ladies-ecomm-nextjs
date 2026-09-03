/**
 * Placeholder catalogue for the frontend-first phase.
 *
 * The route handlers under app/api serve this so the storefront renders real
 * grids, filters and detail pages before Mongo is wired up. It mirrors the
 * product shape the views and RTK Query slices already expect, so swapping in
 * the real controllers is a change of data source only — no component edits.
 *
 * Remove this module once controllers/productController.js is connected.
 */

const brand = (id, name) => ({ _id: id, name, slug: name.toLowerCase().replace(/\s+/g, "-") });

export const BRANDS = [
  brand("b1", "New Balance"),
  brand("b2", "Adidas"),
  brand("b3", "Nike"),
  brand("b4", "Asics"),
  brand("b5", "Salomon"),
  brand("b6", "Puma"),
  brand("b7", "Hoka"),
  brand("b8", "Reebok"),
  brand("b9", "Onitsuka Tiger"),
];

export const CATEGORIES = [
  { _id: "c1", name: "Everyday", slug: "everyday" },
  { _id: "c2", name: "Performance", slug: "performance" },
  { _id: "c3", name: "Statement", slug: "statement" },
  { _id: "c4", name: "After dark", slug: "after-dark" },
];

const SIZES = ["US 7", "US 7.5", "US 8", "US 8.5", "US 9", "US 9.5", "US 10", "US 10.5", "US 11", "US 12"];

const byName = (name) => BRANDS.find((b) => b.name === name);
const catBySlug = (slug) => CATEGORIES.find((c) => c.slug === slug);

/**
 * Ratings, review counts and discounts are never invented here. Real customer
 * activity doesn't exist yet for this placeholder catalogue, so those fields
 * stay genuinely absent (`undefined`) rather than seeded with plausible-looking
 * numbers — components must render their real "no rating yet" / no-discount
 * paths against this data, the same paths they'll hit in production before the
 * first review or promotion lands.
 *
 * `isFeatured` is a merchandising flag, not simulated social proof — it's the
 * one piece of curation data an admin would set directly, so it's fine as an
 * explicit per-product input.
 */
const product = ({
  id,
  brand: brandName,
  name,
  colorway,
  price,
  colors,
  category = "everyday",
  gender = "unisex",
  isNew = false,
  isFeatured = false,
  stockPerSize = 6,
  daysAgo = 40,
}) => ({
  _id: id,
  slug: `${brandName} ${name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  name,
  brand: byName(brandName),
  category: catBySlug(category),
  colorway,
  colors,
  gender,
  basePrice: price,
  discountPrice: undefined,
  images: [],
  sizes: SIZES.map((size) => ({ size, stock: stockPerSize })),
  stock: SIZES.length * stockPerSize,
  rating: undefined,
  numReviews: undefined,
  isNew,
  isFeatured,
  description: `${brandName} ${name} in ${colorway}. ${colors} colorways available.`,
  createdAt: new Date(Date.now() - daysAgo * 864e5).toISOString(),
});

export const PRODUCTS = [
  product({ id: "r1", brand: "New Balance", name: "2002R", colorway: "Rain Cloud", price: 155, colors: 4, isFeatured: true }),
  product({ id: "r2", brand: "Adidas", name: "Samba OG", colorway: "Cloud White & Core Black", price: 110, colors: 6, isFeatured: true }),
  product({ id: "r3", brand: "Nike", name: "Air Max 1", colorway: "Sail & Medium Grey", price: 145, colors: 3, isNew: true, daysAgo: 9, isFeatured: true }),
  product({ id: "r4", brand: "Asics", name: "Gel-1130", colorway: "Cream & Steel Grey", price: 130, colors: 5 }),
  product({ id: "r5", brand: "Salomon", name: "XT-6", colorway: "Black & Phantom", price: 210, colors: 2, category: "performance" }),
  product({ id: "r6", brand: "Puma", name: "Speedcat OG", colorway: "Team Regal Red", price: 100, colors: 4, category: "statement" }),
  product({ id: "r7", brand: "New Balance", name: "990v6", colorway: "Grey Day", price: 210, colors: 3, isFeatured: true }),
  product({ id: "r8", brand: "Nike", name: "P-6000", colorway: "Summit White", price: 130, colors: 2, isNew: true, daysAgo: 5, stockPerSize: 0 }),
  product({ id: "l1", brand: "Adidas", name: "Gazelle Indoor", colorway: "Green & Off White", price: 110, colors: 4, isNew: true, daysAgo: 3 }),
  product({ id: "l2", brand: "Onitsuka Tiger", name: "Mexico 66", colorway: "Cream & Peacoat", price: 115, colors: 3, isNew: true, daysAgo: 4 }),
  product({ id: "l3", brand: "Hoka", name: "Clifton 9", colorway: "Shifting Sand", price: 145, colors: 2, category: "performance", isNew: true, daysAgo: 6 }),
  product({ id: "l4", brand: "Reebok", name: "Club C 85", colorway: "Chalk & Green", price: 90, colors: 5, isNew: true, daysAgo: 7 }),
];

/**
 * Mirrors the filter/sort/paginate contract of utlis/apiFeatures.js so the
 * shop page's URL-driven filters behave the same against mock and real data.
 */
export function queryProducts(searchParams) {
  const get = (k) => searchParams.get(k);
  let list = [...PRODUCTS];

  const search = get("search");
  if (search) {
    const q = search.toLowerCase();
    list = list.filter((p) =>
      `${p.brand?.name} ${p.name} ${p.colorway}`.toLowerCase().includes(q),
    );
  }

  const gender = get("gender");
  if (gender) list = list.filter((p) => p.gender === gender);

  const brandParam = get("brand");
  if (brandParam) {
    list = list.filter(
      (p) => p.brand?._id === brandParam || p.brand?.name === brandParam,
    );
  }

  const category = get("category");
  if (category) {
    list = list.filter(
      (p) => p.category?._id === category || p.category?.slug === category,
    );
  }

  if (get("featured") === "true") list = list.filter((p) => p.isFeatured);
  if (get("sale") === "true") list = list.filter((p) => p.discountPrice);

  const priceMin = Number(get("priceMin") ?? get("price[gte]"));
  const priceMax = Number(get("priceMax") ?? get("price[lte]"));
  if (!Number.isNaN(priceMin) && get("priceMin")) {
    list = list.filter((p) => (p.discountPrice ?? p.basePrice) >= priceMin);
  }
  if (!Number.isNaN(priceMax) && get("priceMax")) {
    list = list.filter((p) => (p.discountPrice ?? p.basePrice) <= priceMax);
  }

  const sort = get("sort") || "name";
  const dir = sort.startsWith("-") ? -1 : 1;
  const field = sort.replace(/^-/, "");
  list.sort((a, b) => {
    const av = field === "createdAt" ? new Date(a.createdAt).getTime() : a[field];
    const bv = field === "createdAt" ? new Date(b.createdAt).getTime() : b[field];
    if (typeof av === "string") return av.localeCompare(bv) * dir;
    return ((av ?? 0) - (bv ?? 0)) * dir;
  });

  const total = list.length;
  const limit = Math.max(1, Number(get("limit")) || 24);
  const page = Math.max(1, Number(get("page")) || 1);
  const products = list.slice((page - 1) * limit, page * limit);

  return { products, total, page, pages: Math.ceil(total / limit) || 1 };
}
