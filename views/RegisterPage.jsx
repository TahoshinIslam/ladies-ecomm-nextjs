"use client";

import { useEffect } from "react";
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

const schema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Enter a valid email"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export default function RegisterPage() {
  const dispatch = useDispatch();
  const router = useRouter();
  const [register, { isLoading }] = useRegisterMutation();
  const [addToCart] = useAddToCartMutation();
  const sp = useSearchParams();
  const redirectParam = sp.get("redirect");
  const user = useSelector(selectCurrentUser);

  // A session already exists — send them on rather than showing a sign-up
  // form for an account they already have.
  useEffect(() => {
    if (user) router.replace(redirectParam || "/");
  }, [user, redirectParam, router]);

  const {
    register: rf,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema) });

  const onSubmit = async ({ confirmPassword, ...data }) => {
    try {
      const res = await register(data).unwrap();
      dispatch(setCredentials({ user: res.user, token: res.token }));
      await mergeGuestCartAfterLogin(dispatch, addToCart);
      toast.success("Account created! Welcome aboard.");
      router.push(redirectParam || "/");
    } catch (err) {
      toast.error(err?.data?.message || "Registration failed");
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
        <h1 className="font-heading text-2xl font-black">Create your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Join and get 10% off your first order.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
          <Input
            label="Name"
            icon={UserIcon}
            placeholder="Your name"
            error={errors.name?.message}
            {...rf("name")}
          />
          <Input
            label="Email"
            type="email"
            icon={Mail}
            placeholder="you@example.com"
            error={errors.email?.message}
            {...rf("email")}
          />
          <Input
            label="Password"
            type="password"
            icon={Lock}
            placeholder="At least 6 characters"
            error={errors.password?.message}
            {...rf("password")}
          />
          <Input
            label="Confirm password"
            type="password"
            icon={Lock}
            placeholder="Repeat password"
            error={errors.confirmPassword?.message}
            {...rf("confirmPassword")}
          />
          <Button type="submit" loading={isLoading} size="lg" className="w-full">
            <UserPlus className="h-4 w-4" />
            Create account
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have one?{" "}
          <Link
            href={redirectParam ? `/login?redirect=${encodeURIComponent(redirectParam)}` : "/login"}
            className="font-semibold text-accent hover:underline"
          >
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
