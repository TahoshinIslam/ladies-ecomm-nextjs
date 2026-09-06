import CartPage from "@/views/CartPage.jsx";

// Phase 10 — extracted the previous "use client" page body verbatim into
// views/CartPage.jsx so this route file can be a plain Server Component
// wrapper carrying `metadata`, matching every other route in this app —
// a Client Component page file cannot export `metadata` at all, which is
// why cart had none before this.
export const metadata = {
  title: "Your bag",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <CartPage />;
}
