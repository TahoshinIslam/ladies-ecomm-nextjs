import { Suspense } from "react";
import OrderDetailPage from "@/views/OrderDetailPage.jsx";

export const metadata = {
  title: "Order",
};

export default function Page() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1480px] px-5 py-20 sm:px-8"><div className="h-8 w-52 animate-pulse rounded-lg bg-media" /></div>}>
      <OrderDetailPage />
    </Suspense>
  );
}
