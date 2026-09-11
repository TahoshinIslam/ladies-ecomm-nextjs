"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Mail, Lock, LogIn } from "lucide-react";
import { toast } from "sonner";

import Input from "../components/ui/Input.jsx";
import Button from "../components/ui/Button.jsx";
import { useLoginMutation } from "../store/userApi.js";
import { setCredentials, selectCurrentUser } from "../store/authSlice.js";
import { useAddToCartMutation } from "../store/shopApi.js";
import { mergeGuestCartAfterLogin } from "../hooks/useCart.js";
import { useLocale } from "../context/LocaleProvider.jsx";

export default function LoginPage() {
  const { t } = useLocale();
  const dispatch = useDispatch();
  const router = useRouter();
  const sp = useSearchParams();
  const redirectParam = sp.get("redirect");
  const [login, { isLoading }] = useLoginMutation();
  const [addToCart] = useAddToCartMutation();
  const user = useSelector(selectCurrentUser);

  // A session already exists — send them on rather than showing a sign-in
  // form for an account they're already in. This also fires for a FRESH
  // login: onSubmit's dispatch(setCredentials(...)) sets `user` in Redux
  // synchronously, re-rendering this component before onSubmit's own
  // `await mergeGuestCartAfterLogin(...)` resolves, so this effect was
  // racing (and, per a real report, winning) against onSubmit's redirect —
  // except this one never checked the role, so it sent every admin to "/"
  // instead of "/admin". Made this the single source of truth for the
  // redirect target (role-aware, matching onSubmit's own now-removed
  // computation) instead of leaving two divergent copies of the same logic.
  useEffect(() => {
    if (!user) return;
    const isAdmin = user.role === "admin";
    router.replace(redirectParam || (isAdmin ? "/admin" : "/"));
  }, [user, redirectParam, router]);

  const schema = useMemo(
    () =>
      z.object({
        email: z.string().email(t("auth.validEmail")),
        password: z.string().min(6, t("auth.passwordMinLength")),
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema) });

  const onSubmit = async (data) => {
    try {
      const res = await login(data).unwrap();
      // Phase 2: no token in the response body — the server already set
      // the session cookie on this same response before the client sees
      // it, so the cart-merge mutation just below authenticates via the
      // cookie automatically.
      dispatch(setCredentials(res.user));
      await mergeGuestCartAfterLogin(dispatch, addToCart);
      toast.success(t("auth.welcomeBackName", { name: res.user.name.split(" ")[0] }));
      // Redirect happens in the effect above, once `user` updates — a
      // second, independent router.push here used to race it (see that
      // effect's comment).
    } catch (err) {
      toast.error(err?.data?.message || t("auth.loginFailed"));
    }
  };

  // Redirecting away in the effect above — render nothing rather than
  // flashing the sign-in form first.
  if (user) return null;

  return (
    <div className="container-x flex min-h-[calc(100vh-200px)] items-center justify-center py-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md rounded-lg border border-border bg-background p-8 shadow-card"
      >
        <h1 className="font-heading text-2xl font-black">{t("auth.welcomeBack")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("auth.signInToContinueShopping")}
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
          <Input
            label={t("auth.emailAddress")}
            type="email"
            icon={Mail}
            placeholder={t("auth.emailPlaceholder")}
            error={errors.email?.message}
            {...register("email")}
          />
          <Input
            label={t("auth.passwordLabel")}
            type="password"
            icon={Lock}
            placeholder="••••••••"
            error={errors.password?.message}
            {...register("password")}
          />
          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-accent hover:underline"
            >
              {t("auth.forgotPassword2")}
            </Link>
          </div>
          <Button type="submit" loading={isLoading} size="lg" className="w-full">
            <LogIn className="h-4 w-4" />
            {t("auth.signIn")}
          </Button>
        </form>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">{t("auth.or")}</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <p className="text-center text-sm text-muted-foreground">
          {t("auth.dontHaveAccount2")}{" "}
          <Link
            href={redirectParam ? `/register?redirect=${encodeURIComponent(redirectParam)}` : "/register"}
            className="font-semibold text-accent hover:underline"
          >
            {t("auth.createOne")}
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
