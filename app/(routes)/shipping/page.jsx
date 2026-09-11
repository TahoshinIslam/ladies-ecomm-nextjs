import ShippingPage from "@/views/ShippingPage.jsx";

export const metadata = {
  title: "Shipping & Returns",
  description: "Delivery areas, charges, timelines, and our 14-day exchange policy.",
  alternates: { canonical: "/shipping" },
};

export default function Page() {
  return <ShippingPage />;
}
