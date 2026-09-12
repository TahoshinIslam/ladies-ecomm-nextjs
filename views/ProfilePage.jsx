import { Home, User as UserIcon, MapPin, Lock } from "lucide-react";

import Breadcrumb from "../components/ui/Breadcrumb.jsx";
import { requireServerUser } from "../lib/serverPageAuth.js";
import { getT } from "../lib/i18n/server.js";
import { serializeForClient } from "../lib/serialize.js";
import { InfoTab, PasswordTab, AddressesTab } from "./ProfileForms.jsx";

// Real Server Component, same pattern as views/DashboardPage.jsx: each of
// the 3 exported page functions below calls requireServerUser() itself and
// redirects BEFORE anything renders. The previous version of this file was
// entirely "use client" and only gated its content behind a
// useSelector(selectCurrentUser) check — a client-side-only UI convenience,
// not a real server-side redirect, unlike every other authenticated route
// in this app (DashboardPage.jsx, OrdersPage.jsx, the whole /admin tree).
// Only the actual interactive forms (InfoTab/PasswordTab/AddressesTab,
// views/ProfileForms.jsx) need to stay client components; the breadcrumb/
// heading shell here is now real server-rendered markup, not client JS
// shipped on every visit.
function AccountSection({ t, crumbLabel, crumbIcon, title, subtitle, children }) {
  return (
    <div>
      <Breadcrumb
        items={[
          { label: t("navigation.home"), href: "/", icon: Home },
          { label: t("navigation.account"), href: "/dashboard" },
          { label: crumbLabel, icon: crumbIcon },
        ]}
      />
      <h1 className="font-heading text-3xl font-black">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      <div className="mt-8">{children}</div>
    </div>
  );
}

// =========== PROFILE INFO (/profile) ===========
export default async function ProfilePage() {
  const user = await requireServerUser("/profile");
  const t = await getT();
  return (
    <AccountSection
      t={t}
      crumbLabel={t("account.navProfile")}
      crumbIcon={UserIcon}
      title={t("account.navProfile")}
      subtitle={t("account.subtitle")}
    >
      <InfoTab user={serializeForClient(user)} />
    </AccountSection>
  );
}

// =========== PASSWORD (/profile/password) ===========
export async function ProfilePasswordPage() {
  await requireServerUser("/profile/password");
  const t = await getT();
  return (
    <AccountSection
      t={t}
      crumbLabel={t("account.navPassword")}
      crumbIcon={Lock}
      title={t("account.navPassword")}
      subtitle={t("account.subtitle")}
    >
      <PasswordTab />
    </AccountSection>
  );
}

// =========== ADDRESSES (/profile/addresses) ===========
export async function ProfileAddressesPage() {
  await requireServerUser("/profile/addresses");
  const t = await getT();
  return (
    <AccountSection
      t={t}
      crumbLabel={t("account.navAddresses")}
      crumbIcon={MapPin}
      title={t("account.navAddresses")}
      subtitle={t("account.subtitle")}
    >
      <AddressesTab />
    </AccountSection>
  );
}
