import TermsPage from "@/views/TermsPage.jsx";

export const metadata = {
  title: "Terms & Conditions",
  description: "The terms that apply when you use this site and place an order.",
  alternates: { canonical: "/terms" },
};

export default function Page() {
  return <TermsPage />;
}
