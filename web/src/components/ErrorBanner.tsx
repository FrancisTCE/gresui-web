import { AlertCircle } from "lucide-react";

import { cn } from "@/lib/utils";

/** Compass-style error banner: red left-border card with the DB message. */
export function ErrorBanner({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border border-l-4 border-danger/40 border-l-danger bg-danger/10 px-3 py-2 text-sm text-foreground",
        className,
      )}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />
      <span className="min-w-0 break-words font-mono text-xs leading-relaxed">
        {message}
      </span>
    </div>
  );
}
