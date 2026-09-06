"use client";

// Phase 11 — closes a real Phase 10 carryover: LoginPage.jsx has always
// linked to /forgot-password, but no page existed here at all (only the
// JSON API route app/api/users/forgot-password/route.js). The RTK Query
// mutation (useForgotPasswordMutation) and shared Zod schema
// (schemas/forgotPasswordSchema, reused client-side the same way
// RegisterPage.jsx reuses PASSWORD_MIN_LENGTH) already existed — only the
// page itself was missing.
import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Mail, ArrowLeft } from "lucide-react";

import Input from "../components/ui/Input.jsx";
import Button from "../components/ui/Button.jsx";
import { useForgotPasswordMutation } from "../store/userApi.js";
import { useLocale } from "../context/LocaleProvider.jsx";

export default function ForgotPasswordPage() {
  const { t } = useLocale();
  const [forgotPassword, { isLoading }] = useForgotPasswordMutation();
  const [submitted, setSubmitted] = useState(false);

  const schema = z.object({ email: z.string().email(t("auth.validEmail")) });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema) });

  const onSubmit = async (data) => {
    // The API's own response is already enumeration-safe (identical
    // {success:true} whether or not the email exists — see
    // services/userService.js's forgotPassword()). This form preserves
    // that: it shows the SAME success state regardless of the mutation's
    // outcome, and never inspects/branches on the response body content
    // to decide what to show — the only thing that would change the UI
    // is a genuine network/request failure (rate-limited, malformed
    // body), which the caught branch handles identically for every
    // email, real or not.
    try {
      await forgotPassword(data).unwrap();
    } catch {
      // Deliberately swallowed: showing a different UI state on failure
      // here would itself be a new enumeration signal (e.g. "this
      // request failed" appearing only for real accounts due to some
      // downstream difference). The rate-limit case is the one genuine
      // exception a real user could hit — but even then, the safest,
      // simplest behavior is the same confirmation screen; a rate-limited
      // attacker learns nothing new, and a rate-limited real user can
      // just wait and retry.
    } finally {
      setSubmitted(true);
    }
  };

  return (
    <div className="container-x flex min-h-[calc(100vh-200px)] items-center justify-center py-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md rounded-lg border border-border bg-background p-8 shadow-card"
      >
        <h1 className="font-heading text-2xl font-black">{t("auth.resetPassword")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("auth.forgotPasswordSubtitle")}</p>

        {submitted ? (
          <div className="mt-6">
            <p role="status" aria-live="polite" className="text-sm text-foreground">
              {t("auth.forgotPasswordSuccess")}
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              {t("auth.backToLogin")}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
            <Input
              label={t("auth.emailAddress")}
              type="email"
              autoComplete="email"
              icon={Mail}
              placeholder={t("auth.emailPlaceholder")}
              error={errors.email?.message}
              {...register("email")}
            />
            <Button type="submit" loading={isLoading} size="lg" className="w-full">
              {t("auth.forgotPasswordSubmit")}
            </Button>
            <Link
              href="/login"
              className="flex items-center justify-center gap-1.5 text-sm font-medium text-accent hover:underline"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              {t("auth.backToLogin")}
            </Link>
          </form>
        )}
      </motion.div>
    </div>
  );
}
