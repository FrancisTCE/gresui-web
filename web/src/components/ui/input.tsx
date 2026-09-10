import type { InputHTMLAttributes } from "react";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-8 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground transition-colors placeholder:text-subtle hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-0",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
