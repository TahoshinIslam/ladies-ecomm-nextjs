"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Mail, Lock, User as UserIcon, UserPlus } from "lucide-react";
import { toast } from "sonner";

import Input from "../components/ui/Input.jsx";
import Button from "../components/ui/Button.jsx";
import { useRegisterMutation } from "../store/userApi.js";
import { useAddToCartMutation } from "../store/shopApi.js";
import { setCredentials, selectCurrentUser } from "../store/authSlice.js";
import { mergeGuestCartAfterLogin } from "../hooks/useCart.js";
import { useLocale } from "../context/LocaleProvider.jsx";

export default function RegisterPage() {
  const { t } = useLocale();
  const dispatch = useDispatch();
  const router = useRouter();
  const [registerUser, { isLoading }] = useRegisterMutation();
  const [addToCart] = useAddToCartMutation();
  const sp = useSearchParams();
  const redirectParam = sp.get("redirect");
  const user = useSelector(selectCurrentUser);

  // A session already exists — send them on rather than showing a sign-up
  // form for an account they already have.
  useEffect(() => {
    if (user) router.replace(redirectParam || "/");
  }, [user, redirectParam, router]);

  const schema = useMemo(
    () =>
      z
        .object({
          name: z.string().min(2, t("auth.nameMinLength")),
          email: z.string().email(t("auth.validEmail")),
          password: z.string().min(6, t("auth.passwordMinLength")),
          confirmPassword: z.string(),
        })
        .refine((d) => d.password === d.confirmPassword, {
          message: t("auth.passwordsDontMatch"),
          path: ["confirmPassword"],
        }),
    [t],
  );

  const {
    register: rf,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema) });

  const onSubmit = async ({ confirmPassword, ...data }) => {
    try {
      const res = await registerUser(data).unwrap();
      dispatch(setCredentials({ user: res.user, token: res.token }));
      await mergeGuestCartAfterLogin(dispatch, addToCart);
      toast.success(t("auth.accountCreated"));
      router.push(redirectParam || "/");
    } catch (err) {
      toast.error(err?.data?.message || t("auth.registrationFailed"));
    }
  };

  // Redirecting away in the effect above — render nothing rather than
  // flashing the sign-up form first.
  if (user) return null;

  return (
    <div className="container-x flex min-h-[calc(100vh-200px)] items-center justify-center py-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md rounded-lg border border-border bg-background p-8 shadow-card"
      >
        <h1 className="font-heading text-2xl font-black">{t("auth.createYourAccount")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("auth.joinDiscount")}
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
          <Input
            label={t("auth.fullNameLabel")}
            icon={UserIcon}
            placeholder={t("auth.namePlaceholder")}
            error={errors.name?.message}
            {...rf("name")}
          />
          <Input
            label={t("auth.emailAddress")}
            type="email"
            icon={Mail}
            placeholder={t("auth.emailPlaceholder")}
            error={errors.email?.message}
            {...rf("email")}
          />
          <Input
            label={t("auth.passwordLabel")}
            type="password"
            icon={Lock}
            placeholder={t("auth.passwordPlaceholder")}
            error={errors.password?.message}
            {...rf("password")}
          />
          <Input
            label={t("auth.confirmPasswordLabel")}
            type="password"
            icon={Lock}
            placeholder={t("auth.repeatPassword")}
            error={errors.confirmPassword?.message}
            {...rf("confirmPassword")}
          />
          <Button type="submit" loading={isLoading} size="lg" className="w-full">
            <UserPlus className="h-4 w-4" />
            {t("auth.createAccount")}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t("auth.alreadyHaveOne")}{" "}
          <Link
            href={redirectParam ? `/login?redirect=${encodeURIComponent(redirectParam)}` : "/login"}
            className="font-semibold text-accent hover:underline"
          >
            {t("auth.signIn")}
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
