import FaqPage from "@/views/FaqPage.jsx";

export const metadata = {
  title: "FAQ",
  description: "Answers to the questions shoppers ask us most.",
  alternates: { canonical: "/faq" },
};

export default function Page() {
  return <FaqPage />;
}
