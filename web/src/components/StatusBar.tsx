// StatusBar — a thin always-on readout of what the app is connected to and
// what the active view just did. Everything here is passive: no controls, so
// it never competes with the toolbar above it.
import { Clock, Hash, Radio } from "lucide-react";

import { useAppStore } from "@/AppStore.tsx";
import { formatCount, formatRowCount } from "@/lib/format.ts";

export function StatusBar() {
  const { connStatus, viewStatus, active } = useAppStore();

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-raised px-3 text-[11px] text-subtle">
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className="size-1.5 shrink-0 rounded-full bg-accent"
          aria-hidden
        />
        <span className="truncate font-mono text-muted">
          {connStatus.user}@{connStatus.host}:{connStatus.port}
          {connStatus.database ? `/${connStatus.database}` : ""}
        </span>
      </span>

      {active ? (
        <>
          <Sep />
          <span className="truncate font-mono">
            {active.schema}.{active.table}
          </span>
        </>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-3">
        {viewStatus.label ? (
          <span className="flex items-center gap-1.5">
            <Radio className="size-3" />
            {viewStatus.label}
          </span>
        ) : null}
        {viewStatus.total !== undefined ? (
          <span className="flex items-center gap-1.5 tabular-nums">
            <Hash className="size-3" />
            {viewStatus.rows !== undefined
              ? `${formatCount(viewStatus.rows)} shown · `
              : ""}
            {formatRowCount(viewStatus.total, viewStatus.estimated ?? false)}
          </span>
        ) : null}
        {viewStatus.elapsedMs !== undefined ? (
          <span className="flex items-center gap-1.5 tabular-nums">
            <Clock className="size-3" />
            {formatDuration(viewStatus.elapsedMs)}
          </span>
        ) : null}
      </div>
    </footer>
  );
}

function Sep() {
  return <span className="h-3 w-px shrink-0 bg-border" aria-hidden />;
}

/** Sub-second timings read better in ms; past that, seconds with one decimal. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}
