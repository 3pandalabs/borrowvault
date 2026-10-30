import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-zinc-900 text-white",
        outline: "border-zinc-300 text-zinc-700",
        good: "border-transparent bg-emerald-100 text-emerald-800",
        bad: "border-transparent bg-rose-100 text-rose-800",
        warn: "border-transparent bg-amber-100 text-amber-800",
        muted: "border-transparent bg-zinc-100 text-zinc-600",
        info: "border-transparent bg-sky-100 text-sky-800",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
