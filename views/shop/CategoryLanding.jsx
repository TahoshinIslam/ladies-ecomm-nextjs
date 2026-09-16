import Image from "next/image";
import Link from "next/link";
import { Home, LayoutGrid } from "lucide-react";

import Breadcrumb from "../../components/ui/Breadcrumb.jsx";
import { getCachedCategories, getCachedProductList } from "../../lib/serverDataCache.js";
import { getShopCacheKey } from "../../lib/shopCacheEligibility.js";
import { listProducts } from "../../services/productService.js";
import { serializeForClient } from "../../lib/serialize.js";
import { getServerLocale, getT } from "../../lib/i18n/server.js";
import { localizeCategoryList } from "../../lib/i18n/localize.js";
import { departmentName } from "../../lib/i18n/catalog.js";
import { resolveImage } from "../../lib/utils.js";

// A browsing waypoint for any category that itself has children (e.g.
// "Cosmetics" under Beauty & Health, or "Food") — a real tile per direct
// child, each with a genuine product count and a representative photo
// (the child's own admin-set `image`, falling back to its top-rated real
// product's photo — same convention views/HomePage.jsx's departments grid
// already uses). Clicking a tile either drills one level further (if that
// child itself has children) or lands on the real filtered product grid
// (ShopPageClient) once it's a genuine leaf — views/ShopPage.jsx decides
// which by checking isLeafCategory() before ever rendering this component.
export default async function CategoryLanding({ categoryId }) {
  const [t, locale, rawCategories] = await Promise.all([getT(), getServerLocale(), getCachedCategories()]);
  const categories = localizeCategoryList(rawCategories, locale);
  const byId = new Map(categories.map((c) => [String(c._id), c]));

  const category = byId.get(categoryId);
  if (!category) {
    return (
      <div className="container-x py-20 text-center text-stone">{t("shop.noProductsMatch")}</div>
    );
  }

  // A real product's `topCategory` denormalizes to its category's
  // IMMEDIATE parent (models/productModel.js), never the category itself —
  // so both counting and linking a child tile need a DIFFERENT query field
  // depending on whether that child is itself a leaf:
  //  - non-leaf child (has its own children, e.g. "Cosmetics" under Beauty
  //    & Health): its real leaf grandchildren's products denormalize to
  //    THIS child's own id, so `category=` (aliased to topCategory) is
  //    correct — same convention views/HomePage.jsx's departments grid
  //    already uses, and drilling into it means moving `category=` there.
  //  - leaf child (e.g. "Face Wash" under Cosmetics): its own products'
  //    `category` field IS this child's id directly, but their
  //    `topCategory` is this child's PARENT — `category=` would always
  //    read 0. `style=` (aliased to the real `category` field) is what
  //    actually matches, kept alongside `category=<this page's own id>`
  //    (the same two-param convention ShopPageClient's own Style filter
  //    uses) rather than replacing it.
  const children = categories
    .filter((c) => String(c.parent) === categoryId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))
    .map((c) => ({
      ...c,
      isLeaf: !categories.some((x) => String(x.parent) === String(c._id)),
    }));

  const fetchOne = async (query) => {
    const cacheKey = getShopCacheKey(query, { isAdmin: false });
    const result = cacheKey
      ? await getCachedProductList(query, cacheKey, { includeFacets: false })
      : serializeForClient(await listProducts(query, { isAdmin: false, includeFacets: false }));
    return result;
  };

  const previews = await Promise.all(
    children.map((c) =>
      c.isLeaf
        ? fetchOne({ limit: 1, style: c._id, sort: "-rating" })
        : fetchOne({ limit: 1, category: c._id, sort: "-rating" }),
    ),
  );

  // Ancestor trail (Home > Shop > ... > this category), walking `parent`
  // pointers up from the current category — real data, not a fixed depth
  // assumption, so it reads correctly whether this category is 1 or 2
  // levels below a division.
  const trail = [];
  let cur = category;
  while (cur) {
    trail.unshift(cur);
    cur = cur.parent ? byId.get(String(cur.parent)) : null;
  }

  const breadcrumbItems = [
    { label: t("navigation.home"), href: "/", icon: Home },
    { label: t("navigation.shop"), href: "/shop", icon: LayoutGrid },
    ...trail.map((c) => ({
      label: departmentName(locale, c.slug, c.name),
      href: `/shop?category=${c._id}`,
    })),
  ];

  return (
    <div className="container-x py-10">
      <Breadcrumb items={breadcrumbItems} />
      <div className="eyebrow">{t("shop.browseCategory")}</div>
      <h1 className="mt-4 text-[clamp(30px,3.6vw,46px)] font-semibold leading-none tracking-[-0.03em]">
        {departmentName(locale, category.slug, category.name)}
      </h1>

      {children.length === 0 ? (
        <p className="mt-8 text-stone">{t("shop.noProductsMatch")}</p>
      ) : (
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {children.map((c, i) => {
            const preview = previews[i];
            const image = c.image || preview?.products?.[0]?.images?.[0] || null;
            const name = departmentName(locale, c.slug, c.name);
            const href = c.isLeaf
              ? `/shop?category=${categoryId}&style=${c._id}`
              : `/shop?category=${c._id}`;
            return (
              <Link
                key={c._id}
                href={href}
                data-reveal
                className="group flex flex-col border border-line p-7 transition-colors hover:border-ink focus-ring"
              >
                <p className="text-right text-[12.5px] text-stone">
                  {t("home.productCount", { count: preview?.total ?? 0 })}
                </p>
                <div className="relative mt-3 aspect-4/3 overflow-hidden bg-media">
                  {image ? (
                    <Image
                      src={resolveImage(image, 500)}
                      alt=""
                      fill
                      sizes="(max-width: 1024px) 100vw, 33vw"
                      className="object-cover object-top transition-transform duration-300 group-hover:scale-[1.04]"
                    />
                  ) : (
                    <div aria-hidden="true" className="absolute inset-0 hatch" />
                  )}
                </div>
                <h3 className="mt-4 text-[17px] font-semibold">{name}</h3>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
