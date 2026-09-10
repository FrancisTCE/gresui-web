import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium leading-none transition-colors [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-accent-soft text-accent-text",
        solid: "border-transparent bg-accent text-accent-fg",
        secondary: "border-border bg-surface text-foreground",
        outline: "border-border bg-transparent text-muted",
        muted: "border-transparent bg-surface text-muted",
        danger: "border-transparent bg-danger-soft text-danger-text",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
