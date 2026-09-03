import { cn } from "../../lib/utils.js";

/**
 * The title + description + primary-action row every admin page opens
 * with. Was hand-duplicated (near-identically) across Products, Orders,
 * Users, Coupons, Reviews, Categories — one component instead, so the
 * responsive stacking behavior (title/description left, action right on
 * desktop; action drops below on narrow screens) lives in exactly one
 * place.
 */
export default function PageHeader({ title, description, action, className }) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-black sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex flex-none flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}
