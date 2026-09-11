"use client";

import { Suspense, useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";

import Header from "@/components/layout/Header.jsx";
import Footer from "@/components/layout/Footer.jsx";
import CartDrawer from "@/components/layout/CartDrawer.jsx";
import SearchModal from "@/components/layout/SearchModal.jsx";
import MobileNav from "@/components/layout/MobileNav.jsx";
import CompareTray from "@/components/product/CompareTray.jsx";
import QuickAddSheet from "@/components/product/QuickAddSheet.jsx";
import ProductFinder from "@/components/product/ProductFinder.jsx";
import ScrollToTop from "@/components/layout/ScrollToTop.jsx";
import { useLocale } from "@/context/LocaleProvider.jsx";

/**
 * Storefront chrome. Everything customer-facing renders inside this; /admin
 * sits outside it and brings its own shell.
 *
 * The overlays (cart, search, quick-add, finder, compare) are mounted once
 * here rather than per page so their open/closed state survives navigation —
 * same reasoning as the mobile tab bar and offline banner.
 */
export default function StorefrontLayout({ children }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <OfflineBanner />
      <Header />
      <main id="main" className="flex-1 pb-[76px] md:pb-0">
        {children}
      </main>
      <Footer />

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
