import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-[18px] min-w-[18px] select-none items-center justify-center gap-1 rounded border border-border bg-surface px-1 font-mono text-[10px] font-medium leading-none text-muted",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
