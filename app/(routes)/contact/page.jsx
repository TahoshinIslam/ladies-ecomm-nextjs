import ContactPage from "@/views/ContactPage.jsx";

export const metadata = {
  title: "Contact",
  description: "Get in touch with us about an order, a product, or anything else.",
  alternates: { canonical: "/contact" },
};

export default function Page() {
  return <ContactPage />;
}
