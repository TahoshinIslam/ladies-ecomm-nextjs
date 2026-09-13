import { Home, Star } from "lucide-react";

import Breadcrumb from "../components/ui/Breadcrumb.jsx";
import { requireServerUser } from "../lib/serverPageAuth.js";
import { getT } from "../lib/i18n/server.js";
import ReviewsHubClient from "./ReviewsHubClient.jsx";

// Real Server Component, same pattern as views/ProfilePage.jsx/
// views/DashboardPage.jsx: requireServerUser() redirects BEFORE anything
// renders, rather than a client-side-only useSelector gate. Only the
// actual interactive list/form (ReviewsHubClient.jsx) is a Client
// Component; the breadcrumb/heading shell here is real server-rendered
// markup.
export default async function ReviewsHubPage() {
  await requireServerUser("/reviews");
  const t = await getT();
  return (
    <div>
      <Breadcrumb
        items={[
          { label: t("navigation.home"), href: "/", icon: Home },
          { label: t("navigation.account"), href: "/dashboard" },
          { label: t("account.navReviews"), icon: Star },
        ]}
      />
      <h1 className="font-heading text-3xl font-black">{t("account.navReviews")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("account.reviewsSubtitle")}</p>
      <div className="mt-8">
        <ReviewsHubClient />
      </div>
    </div>
  );
}
