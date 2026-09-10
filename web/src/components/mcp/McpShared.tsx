// Bits both MCP panels use. The header is the main one: each panel states its
// scope in the same place, in the same shape, so "which MCP am I in?" is
// answered before the user reads anything else.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils.ts";

export function ScopeHeader({
  icon: Icon,
  title,
  subtitle,
  scope,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  /** The scope chip — what this panel is about (a database, a relation). */
  scope: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3 border-b border-border pb-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-accent/15">
          <Icon className="size-4 text-accent-text" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {scope}
          </div>
          <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
      ) : null}
    </div>
  );
}

/** Green when the server is up, hollow when it is not. */
export function ServerStateDot({
  enabled,
  className,
}: {
  enabled: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("relative flex size-2 shrink-0", className)}
      aria-hidden="true"
    >
      {enabled ? (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
      ) : null}
      <span
        className={cn(
          "relative inline-flex size-2 rounded-full",
          enabled ? "bg-accent" : "border border-border-strong bg-transparent",
        )}
      />
    </span>
  );
}
