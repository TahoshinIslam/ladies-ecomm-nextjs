import { cn } from "../../lib/utils.js";

export default function Skeleton({ className, ...props }) {
  return <div className={cn("skeleton", className)} {...props} />;
}
