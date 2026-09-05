import OrdersPage from "@/views/OrdersPage.jsx";

export const metadata = {
  title: "Orders",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <OrdersPage />
  );
}
