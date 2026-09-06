import { Suspense } from "react";
import ResetPasswordPage from "@/views/ResetPasswordPage.jsx";

export const metadata = {
  title: "Reset password",
  robots: { index: false, follow: false },
};

// The dynamic segment is read once here, server-side, and passed straight
// through as a prop — it never touches any client-side storage; see
// views/ResetPasswordPage.jsx for how it's forwarded to the reset mutation.
export default async function Page({ params }) {
  const { token } = await params;
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1480px] px-5 py-20 sm:px-8"><div className="h-8 w-52 animate-pulse rounded-lg bg-media" /></div>}>
      <ResetPasswordPage token={token} />
    </Suspense>
  );
}
