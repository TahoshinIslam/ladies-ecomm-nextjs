import AdminUsersPage from "@/views/admin/UsersPage.jsx";

export const metadata = {
  title: "Users",
};

export default function Page({ searchParams }) {
  return (
    <AdminUsersPage searchParams={searchParams} />
  );
}
