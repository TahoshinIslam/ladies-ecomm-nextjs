import OrderDetailPage from "@/views/OrderDetailPage.jsx";

export const metadata = {
  title: "Order",
};

// Phase 7 — deliberately NOT wrapped in <Suspense>: this page's
// authentication/ownership check can call notFound() (see
// views/OrderDetailPage.jsx), and Next.js can only set the correct HTTP
// status code for notFound()/redirect() when it happens before any bytes
// have been flushed to the client — a Suspense boundary here would let
// the fallback shell flush first (status 200) and then swap in the
// not-found UI client-side, leaving the wrong 200 status on the actual
// HTTP response. The lookup itself is a single, fast query, so there is
// no real loading-state benefit to streaming it anyway.
export default function Page({ params }) {
  return <OrderDetailPage params={params} />;
}
