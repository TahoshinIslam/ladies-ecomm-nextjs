"use client";

// Always-expanded desktop category sidebar for the homepage hero row —
// unlike HeaderCategoryMenu.jsx's own "Shop by Category" trigger (hover to
// open), this list itself never collapses: every department is visible on
// load, no hover required to reveal it. The actual 3-level hover drill-down
// (department -> style -> further style) is CategoryDrillMenu.jsx, shared
// by both, so the two entry points can never show a different navigation
// experience. Desktop-only (lg+); on smaller screens the mobile drawer
// already covers category access.
import { useLocale } from "../../context/LocaleProvider.jsx";
import CategoryDrillMenu from "./CategoryDrillMenu.jsx";

// `categories` is the only prop — plain serialized data from the server
// component that renders this (HomePage.jsx). `t` comes from useLocale()
// instead of a prop: this is a Client Component rendered directly from an
// async Server Component, and functions can't cross that boundary as a
// prop the way they can between two Client Components.
export default function CategorySidebar({ categories }) {
  const { t } = useLocale();

  if (categories.filter((c) => !c.parent).length === 0) return null;

  return (
    <nav
      aria-label={t("header.departments")}
      className="hidden h-full w-[272px] flex-none overflow-visible rounded-[22px] border border-line bg-surface lg:flex"
    >
      <CategoryDrillMenu categories={categories} className="h-full w-full flex-col" />
    </nav>
  );
}
