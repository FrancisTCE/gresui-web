// Info tab: columns + indexes, read-only.
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { IndexInfo, TableInfo } from "../../../../shared/types.ts";
import { useAppStore } from "@/AppStore.tsx";
import { ErrorBanner } from "@/components/ErrorBanner.tsx";
import { NoTableSelected } from "@/screens/MainShell.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { call, getBindings } from "@/lib/rpc.ts";

export function InfoTab() {
  const { active } = useAppStore();
  const [info, setInfo] = useState<TableInfo | null>(null);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError("");
    try {
      const b = getBindings();
      const [i, ix] = await Promise.all([
        call(b.getTableInfo(active.schema, active.table)),
        call(b.listIndexes(active.schema, active.table)),
      ]);
      setInfo(i);
      setIndexes(ix);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
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
          <span className="font-mono text-accent">{active.schema}</span>
          <span className="text-muted">.</span>
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
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Columns ({info.columns.length})
          </h3>
          <div className="mb-5 overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-raised text-left text-xs text-muted">
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
                    <td className="px-3 py-1.5 font-mono text-xs text-accent">
                      {c.type}
                    </td>
                    <td className="px-3 py-1.5 text-muted">
                      {c.notNull ? (
                        <Badge variant="muted">NOT NULL</Badge>
                      ) : (
                        "yes"
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs text-muted">
                      {c.hasDefault ? "yes" : "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      {c.isPk ? (
                        <Badge variant="default">PK</Badge>
                      ) : (
                        "—"
                      )}
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
                    {ix.unique ? (
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
