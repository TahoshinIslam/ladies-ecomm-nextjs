import { Suspense } from "react";
import ForgotPasswordPage from "@/views/ForgotPasswordPage.jsx";

export const metadata = {
  title: "Forgot password",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1480px] px-5 py-20 sm:px-8"><div className="h-8 w-52 animate-pulse rounded-lg bg-media" /></div>}>
      <ForgotPasswordPage />
    </Suspense>
  );
}
