"use client";

import { forwardRef } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils.js";

/**
 * Variants follow the board's two-tier CTA system: `accent` (vermillion) is the
 * single loudest action on a view — hero, checkout, add to bag — and `primary`
 * (ink) is everything else that still needs to read as a button. Both invert
 * into the other colour on hover, which is what gives the set its snap.
 */
const variants = {
  primary:
    "bg-ink text-canvas hover:bg-verm hover:text-white",
  accent:
    "bg-verm text-white hover:bg-ink hover:text-canvas",
  outline:
    "border border-ink bg-transparent text-ink hover:bg-ink hover:text-canvas",
  subtle:
    "border border-line bg-transparent text-ink hover:border-ink hover:bg-wash",
  ghost: "bg-transparent text-ink hover:bg-wash",
  danger: "bg-danger text-white hover:opacity-90",
  success: "bg-success text-white hover:opacity-90",
  link: "h-auto bg-transparent p-0 text-verm underline-offset-4 hover:underline",
};

const sizes = {
  sm: "h-9 px-3 text-[13px]",
  md: "h-11 px-4 text-[14px]",
  lg: "h-12 px-5 text-[15px]",
  xl: "h-[54px] px-6 text-base",
  icon: "h-11 w-11 p-0",
};

const Button = forwardRef(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      className,
      children,
      asChild = false,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const classes = cn(
      "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[9px] font-semibold transition-colors focus-ring disabled:cursor-not-allowed disabled:opacity-50",
      variants[variant] ?? variants.primary,
      sizes[size] ?? sizes.md,
      className,
    );

    const content = (
      <>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </>
    );

    // `asChild` lets a <Link> own navigation while borrowing button styling.
    if (asChild) {
      return (
        <span ref={ref} className={classes} {...props}>
          {content}
        </span>
      );
    }

    return (
      <motion.button
        ref={ref}
        type={type}
        whileTap={{ scale: 0.98 }}
        disabled={disabled || loading}
        className={classes}
        {...props}
      >
        {content}
      </motion.button>
    );
  },
);
Button.displayName = "Button";
export default Button;
