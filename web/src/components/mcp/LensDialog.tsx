// LensDialog — narrow what one MCP key sees of one relation.
//
// A lens is two things: columns the agent must not see, and a row filter that
// bounds which rows exist for it at all. The backend applies both as a
// projection the agent reads *through* (see backend/data.ts): the hidden
// columns are not in scope for anything the agent writes, so a filter naming
// one errors rather than leaking the value by inference.
//
// Hiding nothing and filtering nothing is the same as having no lens, and the
// backend stores it that way — so "Remove lens" and "save an empty lens" have
// one meaning, not two.
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { call, getBindings } from "@/lib/rpc.ts";
import { cn } from "@/lib/utils.ts";
import type {
  ColumnInfo,
  McpKeyInfo,
  McpLens,
} from "../../../../shared/types.ts";

export function LensDialog({
  open,
  onOpenChange,
  keyInfo,
  /** The relation, as the allowlist spells it — what gets stored. */
  tableRef,
  database,
  schema,
  table,
  existing,
  onSave,
  onClear,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
  keyInfo: McpKeyInfo;
  tableRef: string;
  database: string;
  schema: string;
  table: string;
  existing: McpLens | null;
  onSave(lens: McpLens): Promise<void>;
  onClear(): Promise<void>;
}) {
  const [columns, setColumns] = useState<ColumnInfo[] | null>(null);
  const [pkColumns, setPkColumns] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setBusy(false);
    setHidden(new Set(existing?.hiddenColumns ?? []));
    setFilter(existing?.rowFilter ?? "");
    setColumns(null);
    void (async () => {
      try {
        const info = await call(
          getBindings().getTableInfo(database, schema, table),
        );
        setColumns(info.columns);
        setPkColumns(info.pkColumns);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [open, existing, database, schema, table]);

  const visible = useMemo(
    () => (columns ?? []).filter((c) => !hidden.has(c.name)),
    [columns, hidden],
  );

  /** Hiding a key column is allowed but costs the agent row identity, and
   * costs the operator the grid highlight — say so rather than forbid it. */
  const hidesKey = pkColumns.some((c) => hidden.has(c));
  const hidesEverything =
    columns !== null && columns.length > 0 && visible.length === 0;
  const restricts = hidden.size > 0 || filter.trim() !== "";

  function toggle(name: string): void {
    setHidden((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      if (restricts) {
        await onSave({
          table: tableRef,
          hiddenColumns: [...hidden],
          rowFilter: filter.trim(),
        });
      } else {
        await onClear();
      }
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clear(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await onClear();
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Lens on{" "}
            <code className="font-mono">
              {schema}.{table}
            </code>
          </DialogTitle>
          <DialogDescription>
            What &ldquo;{keyInfo.name}&rdquo; sees of this relation. Hidden
            columns are absent from the schema it reads, not just from the rows
            — it cannot select them, filter on them, or learn they exist.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-sm font-medium leading-none text-foreground">
              Columns{" "}
              {columns ? (
                <span className="text-muted">
                  ({visible.length}/{columns.length} visible)
                </span>
              ) : null}
            </legend>
            {columns === null ? (
              <p className="flex items-center gap-2 rounded-md border border-border bg-raised px-3 py-4 text-xs text-muted">
                <Loader2 className="size-3.5 animate-spin" />
                Reading columns…
              </p>
            ) : (
              <div className="max-h-[34vh] overflow-y-auto rounded-md border border-border bg-raised p-1">
                {columns.map((c) => {
                  const off = hidden.has(c.name);
                  return (
                    <label
                      key={c.name}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-surface",
                        off && "opacity-60",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={!off}
                        onChange={() => toggle(c.name)}
                        className="size-3.5 accent-[var(--accent)]"
                        aria-label={`${c.name} visible to this key`}
                      />
                      {off ? (
                        <EyeOff className="size-3.5 shrink-0 text-warning-text" />
                      ) : (
                        <Eye className="size-3.5 shrink-0 text-subtle" />
                      )}
                      <code
                        className={cn(
                          "min-w-0 flex-1 truncate font-mono text-xs text-foreground",
                          off && "line-through",
                        )}
                      >
                        {c.name}
                      </code>
                      {pkColumns.includes(c.name) ? (
                        <Badge variant="outline" className="shrink-0">
                          key
                        </Badge>
                      ) : null}
                      <span className="shrink-0 font-mono text-[11px] text-muted">
                        {c.type}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lens-filter">Row filter (optional)</Label>
            <Input
              id="lens-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="tenant_id = 42"
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted">
              Raw SQL, applied before anything the agent sends — its own{" "}
              <code className="font-mono">where</code> can only narrow this
              further. It may only name columns that stay visible above.
            </p>
          </div>

          {hidesEverything ? (
            <Note tone="danger">
              Every column is hidden, which leaves nothing to read. The backend
              rejects this — leave at least one column visible.
            </Note>
          ) : hidesKey ? (
            <Note tone="warning">
              This hides part of the primary key. The key still works, but rows
              it returns cannot be identified, so they will not light up in the
              grid.
            </Note>
          ) : restricts ? (
            <Note tone="ok">
              &ldquo;{keyInfo.name}&rdquo; will read this table through the lens
              above. Every other key is unaffected.
            </Note>
          ) : (
            <Note tone="plain">
              Nothing hidden and no filter — saving this removes the lens, and
              the key sees the whole table.
            </Note>
          )}

          {error ? (
            <div
              role="alert"
              className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-xs"
            >
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {existing ? (
            <Button
              variant="ghost"
              onClick={() => void clear()}
              disabled={busy}
              className="mr-auto"
            >
              Remove lens
            </Button>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={busy || hidesEverything || columns === null}
          >
            {busy ? "Saving…" : restricts ? "Apply lens" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Note({
  tone,
  children,
}: {
  tone: "ok" | "warning" | "danger" | "plain";
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        tone === "ok" && "border-accent/40 bg-accent/10 text-foreground",
        tone === "warning" &&
          "border-warning-text/40 bg-warning-text/10 text-foreground",
        tone === "danger" && "border-danger/40 bg-danger/10 text-foreground",
        tone === "plain" && "border-border bg-raised text-muted",
      )}
    >
      {tone === "ok" ? (
        <ShieldCheck className="mt-px size-3.5 shrink-0 text-accent-text" />
      ) : null}
      <span>{children}</span>
    </p>
  );
}
