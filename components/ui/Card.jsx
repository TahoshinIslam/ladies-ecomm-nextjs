import { cn } from "../../lib/utils.js";

export const Card = ({ className, ...props }) => (
  <div
    className={cn("rounded-2xl border border-line bg-surface", className)}
    {...props}
  />
);
