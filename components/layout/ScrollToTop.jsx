"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * The App Router already restores scroll on back/forward and scrolls to top on
 * push, so the manual position bookkeeping this component used to do under
 * react-router is gone.
 *
 * What Next does *not* do is animate to an in-page anchor that was present in
 * the URL on first load — and this store leans on them (#rotation,
 * #just-landed, #categories from the mega menu and hero CTAs). That is the one
 * job left here.
 */
export default function ScrollToTop() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const { hash } = window.location;
    if (!hash || hash.length < 2) return;

    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!target) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Wait a frame so freshly-streamed content is laid out before measuring.
    const raf = requestAnimationFrame(() => {
      target.scrollIntoView({
        behavior: reduced ? "auto" : "smooth",
        block: "start",
      });
    });

    return () => cancelAnimationFrame(raf);
  }, [pathname, searchParams]);

  return null;
}
