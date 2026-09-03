import AdminLayout from "@/components/admin/AdminLayout.jsx";

export const metadata = {
  title: {
    default: "Admin · TAHOS.",
    template: "%s · Admin · TAHOS.",
  },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }) {
  return <AdminLayout>{children}</AdminLayout>;
}
