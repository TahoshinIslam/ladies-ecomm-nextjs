import AccountSidebar from "@/components/account/AccountSidebar.jsx";

/**
 * Shared shell for the whole "my account" area: Dashboard, Profile info,
 * Addresses, Password. A route group (the "(account)" segment) so these
 * routes keep their existing URLs (/dashboard, /profile, /profile/addresses,
 * /profile/password) while sharing one persistent left sidebar instead of
 * each page owning its own (previously only views/ProfilePage.jsx had a
 * left nav, scoped to its own 3 tabs, with Dashboard entirely outside it).
 *
 * Stays a Server Component — AccountSidebar is the only piece that needs
 * the client (it reads the current path to highlight the active link), so
 * every page nested under this (Dashboard, Orders-style server pages) can
 * keep rendering as a real Server Component underneath it.
 */
export default function AccountLayout({ children }) {
  return (
    <div className="container-x py-10">
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <AccountSidebar />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
