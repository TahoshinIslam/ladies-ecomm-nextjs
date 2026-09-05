"use client";

// Phase 7 — the one interactive island on an otherwise server-rendered
// order-detail page: live SSE status refresh, the receipt
// download/auto-download-on-arrival behavior, and the cancel
// confirmation flow. Everything else on the page (items, address,
// payment summary, cost breakdown) is plain server-rendered content that
// needs no client JavaScript to display.
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, X } from "lucide-react";
import { toast } from "sonner";

import Button from "../ui/Button.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import { useCancelOrderMutation } from "../../store/shopApi.js";
import { useOrderStatusStream } from "../../hooks/useOrderStatusStream.js";
import { downloadReceipt } from "../../lib/receipt.js";
import { useLocale } from "../../context/LocaleProvider.jsx";

export default function OrderDetailActions({ order, canCancel }) {
  const router = useRouter();
  const sp = useSearchParams();
  const pathname = usePathname();
  const { t, locale } = useLocale();
  const [cancelOrder, { isLoading: cancelling }] = useCancelOrderMutation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const receiptShown = useRef(false);

  // An admin (or a status-transition side effect) updating this order
  // server-side should reach an open order-detail tab immediately —
  // router.refresh() re-runs the Server Component's data fetch in place
  // (no full navigation, no client-side cache to invalidate), replacing
  // RTK Query's previous refetch()-on-SSE-event wiring now that this
  // page's initial data no longer comes from RTK Query.
  useOrderStatusStream(order._id, () => router.refresh());

  // Auto-open the receipt once when the user arrives here right after a
  // successful checkout (gateway redirect adds ?receipt=1).
  useEffect(() => {
    if (receiptShown.current) return;
    if (sp.get("receipt") === "1") {
      receiptShown.current = true;
      downloadReceipt(order, locale);
      const next = new URLSearchParams(sp);
      next.delete("receipt");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, router, pathname, locale]);

  const handleCancel = async () => {
    try {
      await cancelOrder(order._id).unwrap();
      toast.success(t("orders.orderCancelled"));
      setConfirmOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e?.data?.message || t("orders.couldntCancel"));
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => downloadReceipt(order, locale)}>
        <Download className="h-3 w-3" />
        {t("orders.receipt")}
      </Button>
      {canCancel && (
        <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
          <X className="h-3 w-3" />
          {t("orders.cancel")}
        </Button>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleCancel}
        title={t("orders.cancelOrderTitle")}
        description={t("orders.cancelOrderDesc")}
        confirmLabel={t("orders.yesCancel")}
        loading={cancelling}
      />
    </>
  );
}
