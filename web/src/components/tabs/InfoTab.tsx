// Info tab: columns + indexes, read-only.
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "@/AppStore.tsx";
import { ErrorBanner } from "@/components/ErrorBanner.tsx";
import { NoTableSelected } from "@/components/NoTableSelected.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { formatCount } from "@/lib/format.ts";
import { typeColorClass } from "@/lib/pg-types.ts";
import { call, getBindings } from "@/lib/rpc.ts";
import { cn } from "@/lib/utils.ts";
import type { IndexInfo, TableInfo } from "../../../../shared/types.ts";

export function InfoTab() {
  const { active } = useAppStore();
  const [info, setInfo] = useState<TableInfo | null>(null);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  // `tick` is a refresh nonce: bumping it is how a manual reload re-runs
  // this, so it belongs in the list even though the body never reads it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  const load = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError("");
    try {
      const b = getBindings();
      const [i, ix] = await Promise.all([
        call(b.getTableInfo(active.database, active.schema, active.table)),
        call(b.listIndexes(active.database, active.schema, active.table)),
      ]);
      setInfo(i);
      setIndexes(ix);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // `tick` is not read here — bumping it is how a manual refresh rebuilds
    // this callback, which re-runs the effect below.
  }, [active, tick]);

  useEffect(() => {
    setInfo(null);
    setIndexes([]);
    void load();
  }, [load]);

  if (!active) return <NoTableSelected />;

  return (
    <div className="h-full overflow-y-auto bg-background p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          <span className="font-mono text-accent-text">{active.schema}</span>
          <span className="text-subtle">.</span>
          <span className="font-mono">{active.table}</span>
        </h2>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setTick((t) => t + 1)}
          disabled={loading}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {error ? <ErrorBanner message={error} className="mb-3" /> : null}

      {loading && !info ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}

      {info ? (
        <>
          <dl className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Columns" value={String(info.columns.length)} />
            <Stat
              label="Rows (estimated)"
              value={
                info.rowEstimate === null
                  ? "—"
                  : `~${formatCount(info.rowEstimate)}`
              }
            />
            <Stat
              label="Primary key"
              value={info.pkColumns.length ? info.pkColumns.join(", ") : "none"}
              mono={info.pkColumns.length > 0}
            />
            <Stat label="Indexes" value={String(indexes.length)} />
          </dl>

          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Columns ({info.columns.length})
          </h3>
          <div className="mb-5 overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-raised text-left text-[11px] uppercase text-subtle">
                  <th className="px-3 py-1.5 font-medium">Name</th>
                  <th className="px-3 py-1.5 font-medium">Type</th>
                  <th className="px-3 py-1.5 font-medium">Nullable</th>
                  <th className="px-3 py-1.5 font-medium">Default</th>
                  <th className="px-3 py-1.5 font-medium">Key</th>
                </tr>
              </thead>
              <tbody>
                {info.columns.map((c) => (
                  <tr key={c.name} className="border-t border-border/60">
                    <td className="px-3 py-1.5 font-medium text-foreground">
                      {c.name}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-1.5 font-mono text-xs",
                        typeColorClass(c.type) || "text-muted",
                      )}
                    >
                      {c.type}
                    </td>
                    <td className="px-3 py-1.5 text-muted">
                      {c.notNull ? "no" : "yes"}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs text-muted">
                      {c.hasDefault ? "yes" : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-muted">
                      {c.isPk ? <Badge variant="default">PK</Badge> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Indexes ({indexes.length})
          </h3>
          {indexes.length === 0 ? (
            <p className="text-sm text-muted">No indexes.</p>
          ) : (
            <div className="space-y-2">
              {indexes.map((ix) => (
                <div
                  key={ix.name}
                  className="rounded-md border border-border bg-raised p-3"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {ix.name}
                    </span>
                    {ix.primary ? (
                      <Badge variant="default">primary key</Badge>
                    ) : null}
                    {ix.unique && !ix.primary ? (
                      <Badge variant="secondary">unique</Badge>
                    ) : null}
                  </div>
                  <code className="block break-words font-mono text-xs leading-relaxed text-muted">
                    {ix.definition}
                  </code>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-raised px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd
        className={`truncate text-sm text-foreground${mono ? " font-mono text-xs" : ""}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
