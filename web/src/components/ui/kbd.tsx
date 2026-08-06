import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-raised px-1.5 font-mono text-[11px] font-medium text-muted",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
