"use client";

import { useDispatch, useSelector } from "react-redux";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowRight, Scale } from "lucide-react";

import { useGetCompareProductsQuery } from "../../store/productApi.js";
import { removeFromCompare, clearCompare } from "../../store/uiSlice.js";
import { cn, resolveImage } from "../../lib/utils.js";
import { useLocale } from "../../context/LocaleProvider.jsx";

export default function CompareTray() {
  const { t } = useLocale();
  const compareList = useSelector((s) => s.ui.compareList);
  const dispatch = useDispatch();
  const router = useRouter();
  const pathname = usePathname();

  // Don't show tray on the compare page itself
  const onComparePage = pathname === "/compare";

  // Skip the network call when there's nothing to compare
  const { data } = useGetCompareProductsQuery(compareList, {
    skip: compareList.length === 0,
  });
  const products = data?.products || [];

  const visible = compareList.length > 0 && !onComparePage;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 280 }}
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur shadow-hover"
          role="region"
          aria-label={t("compare.trayRegionLabel")}
        >
          <div className="container-x flex items-center gap-3 py-3">
            <div className="hidden items-center gap-2 text-sm font-semibold text-foreground sm:flex">
              <Scale className="h-4 w-4 text-accent" />
              {t("compare.trayLabel", { count: compareList.length })}
            </div>

            <div className="flex flex-1 gap-2 overflow-x-auto">
              {compareList.map((id) => {
                const p = products.find((x) => x._id === id);
                return (
                  <div
                    key={id}
                    className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-md border border-border bg-muted"
                  >
                    {p?.images?.[0] ? (
                      <Image
                        src={resolveImage(p.images[0], 112)}
                        alt={p.name}
                        fill
                        sizes="56px"
                        className="object-contain"
                      />
                    ) : (
                      <div className="h-full w-full animate-pulse bg-muted" />
                    )}
                    <button
                      onClick={() => dispatch(removeFromCompare(id))}
                      aria-label={t("compare.removeFromTray", { name: p?.name || "" })}
                      className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl-md bg-danger text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => dispatch(clearCompare())}
              className="hidden text-xs font-medium text-muted-foreground hover:text-foreground sm:inline"
            >
              {t("compare.clear")}
            </button>

            <button
              onClick={() => router.push("/compare")}
              disabled={compareList.length < 2}
              className={cn(
                "inline-flex items-center gap-1 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition-opacity",
                compareList.length < 2
                  ? "cursor-not-allowed opacity-50"
                  : "hover:opacity-90",
              )}
            >
              {t("compare.compareCta")}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
