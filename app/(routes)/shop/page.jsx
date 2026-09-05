import { Suspense } from "react";
import ShopPage from "@/views/ShopPage.jsx";

export const metadata = {
  title: "Shop",
};

export default function Page({ searchParams }) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1480px] px-5 py-20 sm:px-8"><div className="h-8 w-52 animate-pulse rounded-lg bg-media" /></div>}>
      <ShopPage searchParams={searchParams} />
    </Suspense>
  );
}
