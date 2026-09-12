"use client";

import { Suspense, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { WifiOff } from "lucide-react";

import Header from "@/components/layout/Header.jsx";
import Footer from "@/components/layout/Footer.jsx";
import MobileNav from "@/components/layout/MobileNav.jsx";
import ScrollToTop from "@/components/layout/ScrollToTop.jsx";
import { useLocale } from "@/context/LocaleProvider.jsx";

// These five overlays are mounted unconditionally below (so their own
// Redux open/closed state survives navigation — see this file's own
// comment) but render nothing until the shopper actually opens one, so
// none of their code needs to be in the initial JS every storefront page
// pays for. `ssr: false` is safe here specifically because they show
// nothing meaningful in server-rendered HTML anyway (closed by default);
// their own internal `open` Redux state is unaffected — this only moves
// WHEN their code downloads, not their mount lifecycle or behavior.
const CartDrawer = dynamic(() => import("@/components/layout/CartDrawer.jsx"), { ssr: false });
const SearchModal = dynamic(() => import("@/components/layout/SearchModal.jsx"), { ssr: false });
const CompareTray = dynamic(() => import("@/components/product/CompareTray.jsx"), { ssr: false });
const QuickAddSheet = dynamic(() => import("@/components/product/QuickAddSheet.jsx"), { ssr: false });
const ProductFinder = dynamic(() => import("@/components/product/ProductFinder.jsx"), { ssr: false });

/**
 * Storefront chrome. Everything customer-facing renders inside this; /admin
 * sits outside it and brings its own shell.
 *
 * The overlays (cart, search, quick-add, finder, compare) are mounted once
 * here rather than per page so their open/closed state survives navigation —
 * same reasoning as the mobile tab bar and offline banner.
 *
 * `initialDepartments` comes from app/(routes)/layout.jsx (a real Server
 * Component) so Header/Footer's department links (Burqa/Hijab/Niqab/...)
 * are already in the very first server-rendered HTML — previously both
 * only had useGetCategoriesQuery()'s client-side fetch to go on, which is
 * undefined during SSR, so every page load rendered the nav WITHOUT those
 * links first and then popped them in a moment later once the browser
 * fetch resolved (a visible layout shift on every single page load).
 * Header/Footer still keep their own live query for freshness on client
 * navigations; this only seeds their very first paint.
 */
export default function StorefrontLayout({ children, initialDepartments }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <OfflineBanner />
      <Header initialDepartments={initialDepartments} />
      <main id="main" className="flex-1 pb-[76px] md:pb-0">
        {children}
      </main>
      <Footer initialDepartments={initialDepartments} />

      <CartDrawer />
      <SearchModal />
      <QuickAddSheet />
      <ProductFinder />
      <CompareTray />
      <MobileNav />
      <Suspense fallback={null}>
        <ScrollToTop />
      </Suspense>
    </div>
  );
}

const subscribeToConnectivity = (callback) => {
  window.addEventListener("offline", callback);
  window.addEventListener("online", callback);
  return () => {
    window.removeEventListener("offline", callback);
    window.removeEventListener("online", callback);
  };
};

/**
 * A dropped connection shouldn't read as a broken app: the bag and saved
 * pairs are local/cached, so we say so rather than letting failed requests
 * speak for themselves.
 *
 * `navigator.onLine` is mutable state that lives outside React, which is
 * exactly what useSyncExternalStore is for — it also supplies the SSR
 * snapshot (always "online") so the server render and the first client
 * render agree, the same problem the Redux storage hydration solves
 * elsewhere in this app.
 */
function OfflineBanner() {
  const { t } = useLocale();
  const offline = useSyncExternalStore(
    subscribeToConnectivity,
    () => !navigator.onLine,
    () => false,
  );

  if (!offline) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 bg-ink px-4 py-2.5 text-center text-[13px] font-medium text-canvas"
    >
      <span className="flex items-center gap-2.5">
        <WifiOff className="h-4 w-4 flex-none" strokeWidth={1.8} />
        {t("common.offlineMessage")}
      </span>
      <button
        onClick={() => window.location.reload()}
        className="rounded-md border border-canvas/30 px-2.5 py-1 text-[12px] font-semibold transition-colors hover:bg-canvas/10 focus-ring"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}
