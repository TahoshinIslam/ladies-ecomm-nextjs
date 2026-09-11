import AdminLayout from "@/components/admin/AdminLayout.jsx";
import { requireServerUser } from "@/lib/serverPageAuth.js";
import { serializeForClient } from "@/lib/serialize.js";
import { redirect } from "next/navigation";

export const metadata = {
  title: {
    default: "Admin · TAHOS.",
    template: "%s · Admin · TAHOS.",
  },
  robots: { index: false, follow: false },
};

// Phase 7 — a general "is this even a staff member" server-side gate,
// checked here (BEFORE AdminLayout, a Client Component, ever renders its
// own chrome) rather than only inside each page. AdminLayout.jsx's own
// client-side gate exists purely for UX (its own doc comment says as
// much) and cannot reliably set the HTTP response status: Next.js can
// only change a redirect()/notFound() call's status code if it resolves
// before any bytes reach the client, and AdminLayout renders its own
// loading/shell UI immediately on the client — racing this exact
// redirect. Running the check here, one layer up, resolves before
// AdminLayout (or any admin page below it) renders anything at all.
// Each individual admin page still enforces its OWN specific permission
// (e.g. views/admin/OverviewPage.jsx's dashboard.view check) — this layer
// only rules out "not logged in" / "not staff at all".
//
// This same, already-validated `user` is also handed to AdminLayout as
// `initialUser` — see that component's own comment for why: without it,
// AdminLayout used to block its ENTIRE shell (sidebar, topbar, and every
// admin page's real content, including Overview's server-rendered charts)
// behind a second, client-only GET /api/users/me round trip, even though
// the exact same question had already been answered right here, one
// render pass earlier. That's what actually produced the blank white
// page on every admin load — not Overview's own data fetching, which was
// already a real cached Server Component the whole time.
export default async function AdminRootLayout({ children }) {
  const user = await requireServerUser("/admin");
  if (!["admin", "employee"].includes(user.role)) redirect("/");
  return <AdminLayout initialUser={serializeForClient(user)}>{children}</AdminLayout>;
}
