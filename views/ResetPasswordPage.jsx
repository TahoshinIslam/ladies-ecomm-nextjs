"use client";

// Phase 11 — closes the other half of the same Phase 10 carryover: the
// password-reset EMAIL (services/userService.js's forgotPassword(),
// via buildAppUrl("reset-password", rawToken)) has always linked here,
// but no page existed. The raw token stays in the URL PATH only (never
// copied into component state, localStorage, or sessionStorage) — it's
// read once from the route param and forwarded directly to the existing
// useResetPasswordMutation, which posts it in the request body per
// app/api/users/reset-password/[token]/route.js's existing contract.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Lock, ArrowLeft } from "lucide-react";

import Input from "../components/ui/Input.jsx";
import Button from "../components/ui/Button.jsx";
import { useResetPasswordMutation } from "../store/userApi.js";
import { PASSWORD_MIN_LENGTH } from "../schemas/authSchemas.js";
import { useLocale } from "../context/LocaleProvider.jsx";

export default function ResetPasswordPage({ token }) {
  const { t } = useLocale();
  const router = useRouter();
  const [resetPassword, { isLoading }] = useResetPasswordMutation();
  const [succeeded, setSucceeded] = useState(false);
  // A malformed/expired/unknown token all get the exact same generic
  // failure message from the server (see services/userService.js's
  // resetPassword() — a non-hex token is rejected with the identical
  // "Invalid or expired reset link" text a genuinely-expired one gets).
  // This page mirrors that: one shared `invalid` state, no attempt to
  // distinguish "malformed" from "not found" from "expired" client-side.
  const [invalid, setInvalid] = useState(false);

  const schema = z.object({
    password: z.string().min(PASSWORD_MIN_LENGTH, t("auth.passwordMinLength")),
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema) });

  const onSubmit = async (data) => {
    setInvalid(false);
    try {
      // The token is forwarded straight from the route param to the
      // mutation — never held in component state beyond this one call,
      // never written to localStorage/sessionStorage, never logged.
      await resetPassword({ token, password: data.password }).unwrap();
      setSucceeded(true);
    } catch {
      setInvalid(true);
    }
  };

  if (succeeded) {
    return (
      <div className="container-x flex min-h-[calc(100vh-200px)] items-center justify-center py-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md rounded-lg border border-border bg-background p-8 shadow-card text-center"
        >
          <h1 className="font-heading text-2xl font-black">{t("auth.resetPassword")}</h1>
          <p role="status" aria-live="polite" className="mt-3 text-sm text-foreground">
            {t("auth.resetPasswordSuccess")}
          </p>
          <Button onClick={() => router.push("/login")} size="lg" className="mt-6 w-full">
            {t("auth.backToLogin")}
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="container-x flex min-h-[calc(100vh-200px)] items-center justify-center py-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md rounded-lg border border-border bg-background p-8 shadow-card"
      >
        <h1 className="font-heading text-2xl font-black">{t("auth.resetPassword")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("auth.resetPasswordSubtitle")}</p>

        {invalid && (
          <p role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {t("auth.invalidResetLink")}
          </p>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
          <Input
            label={t("auth.newPassword")}
            type="password"
            autoComplete="new-password"
            icon={Lock}
            placeholder="••••••••"
            error={errors.password?.message}
            {...register("password")}
          />
          <Button type="submit" loading={isLoading} size="lg" className="w-full">
            {t("auth.resetPasswordSubmit")}
          </Button>
        </form>

        {invalid && (
          <Link
            href="/forgot-password"
            className="mt-4 flex items-center justify-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {t("auth.forgotPassword")}
          </Link>
        )}
      </motion.div>
    </div>
  );
}
