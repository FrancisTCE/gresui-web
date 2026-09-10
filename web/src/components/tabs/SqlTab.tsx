// SQL tab: editor + run/explain/cancel + history + results grid.
import { CircleStop, History, Play, Wand2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { HistoryEntry, QueryResult } from "../../../../shared/types.ts";
import { useAppStore } from "@/AppStore.tsx";
import { ErrorBanner } from "@/components/ErrorBanner.tsx";
import { SqlEditor } from "@/components/SqlEditor.tsx";
import { DataGrid } from "@/components/grid/DataGrid.tsx";
import { ExportMenu } from "@/components/export/ExportMenu.tsx";
import { downloadExport, type ExportFormat } from "@/lib/export.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { call, getBindings } from "@/lib/rpc.ts";

/** Bare identifier when Postgres would accept it, quoted otherwise. */
function ident(name: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replaceAll('"', '""')}"`;
}

function starterQuery(schema: string, table: string): string {
  return `SELECT *
FROM ${ident(schema)}.${ident(table)}
LIMIT 50;`;
}

/** Ask the backend to cancel the in-flight query. Closes over nothing, so it
 * lives out here; a failure means the query already finished. */
async function cancel(): Promise<void> {
  try {
    await call(getBindings().cancelQuery());
  } catch {
    // ignore
  }
}

export function SqlTab({ active }: { active: boolean }) {
  const { theme, toastStore, active: target, lastActive } = useAppStore();
  const [text, setText] = useState("");
  /** The last query this tab wrote for the user; anything else is theirs. */
  const seeded = useRef("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [explain, setExplain] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [editorH, setEditorH] = useState(240);
  const rootRef = useRef<HTMLDivElement>(null);

  // Opening the tab (or picking another table) drops in a runnable query for
  // the current relation — but never over something the user typed.
  const relation = target ?? lastActive;
  useEffect(() => {
    if (!active || !relation) return;
    if (text !== "" && text !== seeded.current) return;
    const next = starterQuery(relation.schema, relation.table);
    if (next === text) return;
    seeded.current = next;
    setText(next);
    // `text` is deliberately absent: re-seeding on every keystroke would fight
    // the user for the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, relation?.schema, relation?.table]);

  async function run(): Promise<void> {
    if (running || !text.trim()) return;
    setRunning(true);
    setError("");
    try {
      const r = await call(getBindings().runSql(text, { explain }));
      setResult(r);
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function openHistory(): Promise<void> {
    setHistory(await call(getBindings().listHistory()));
    setHistoryOpen(true);
  }

  async function clearHistory(): Promise<void> {
    await call(getBindings().clearHistory());
    setHistory([]);
  }

  function exportResults(format: ExportFormat): void {
    if (!result || result.columns.length === 0) return;
    downloadExport(result.columns, result.rows, format, "gresui-query");
    toastStore.toast({
      title: `Exported ${result.rows.length.toLocaleString()} row${result.rows.length === 1 ? "" : "s"}`,
    });
  }

  const runCb = useCallback(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, running, explain]);

  function onSplitterDown(e: React.PointerEvent): void {
    e.preventDefault();
    const startY = e.clientY;
    const startH = editorH;
    // Resolve the pane once, up front. Reading it from ev.target mid-drag
    // failed the moment the pointer left the pane (over the sidebar, the
    // results grid, or outside the window), snapping the editor to a
    // hardcoded 600px ceiling.
    const root = rootRef.current;
    const onMove = (ev: PointerEvent): void => {
      const max = root ? root.clientHeight - 120 : 600;
      setEditorH(Math.min(max, Math.max(90, startH + (ev.clientY - startY))));
    };
    const onUp = (): void => {
      document.body.classList.remove("select-none");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // stop the drag from selecting the SQL text it passes over
    document.body.classList.add("select-none");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Ctrl/Cmd+Enter runs the query. CodeMirror already binds Mod-Enter inside
  // the editor (it calls run() and does NOT stop propagation), so when the
  // editor is focused this listener must stay out of the way — otherwise the
  // same keystroke would fire run() twice. It only handles the case where
  // focus is elsewhere in the SQL tab.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (!active) return; // tab hidden — never fire from another tab
      const t = e.target;
      if (t instanceof Element && t.closest(".cm-content")) return; // editor handled it
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void run();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, text, running, explain]);

  const isExplain = explain && result !== null && result.command === "EXPLAIN";

  return (
    <div ref={rootRef} className="sql-root flex h-full flex-col bg-background">
      {/* toolbar */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-raised px-2 py-1.5">
        <Button size="sm" onClick={() => void run()} disabled={running || !text.trim()}>
          <Play className={running ? "animate-pulse" : ""} />
          Run
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant={explain ? "default" : "secondary"}
              onClick={() => setExplain((v) => !v)}
            >
              <Wand2 />
              Explain
            </Button>
          </TooltipTrigger>
          <TooltipContent>EXPLAIN (ANALYZE, BUFFERS) — runs in a rolled-back transaction</TooltipContent>
        </Tooltip>
        {running ? (
          <Button size="sm" variant="destructive" onClick={() => void cancel()}>
            <CircleStop />
            Cancel
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => void openHistory()}>
          <History />
          History
        </Button>
        {running ? (
          <span className="ml-auto pr-1 text-xs text-muted">Running…</span>
        ) : null}
      </div>

      {/* editor (resizable) */}
      <div className="shrink-0 border-b border-border" style={{ height: editorH }}>
        <SqlEditor value={text} onChange={setText} onRun={runCb} theme={theme} />
      </div>
      <div
        className="flex h-1.5 shrink-0 cursor-row-resize items-center justify-center hover:bg-surface-active"
        onPointerDown={onSplitterDown}
      >
        <div className="h-0.5 w-10 rounded bg-border" />
      </div>

      {/* results */}
      <div className="min-h-0 flex-1">
        {error ? (
          <div className="h-full overflow-auto p-2">
            <ErrorBanner message={error} />
          </div>
        ) : running ? (
          <div className="flex h-full items-center justify-center">
            <Skeleton className="h-32 w-2/3" />
          </div>
        ) : isExplain ? (
          <pre className="h-full overflow-auto bg-code p-3 font-mono text-xs leading-relaxed text-foreground">
            {result.rows.map((r) => String(r[0])).join("\n")}
          </pre>
        ) : result ? (
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1">
              <DataGrid
                columns={result.columns}
                rows={result.rows}
                className="h-full"
              />
            </div>
            <div className="flex shrink-0 items-center gap-2 border-t border-border bg-raised px-3 py-1.5 text-xs text-muted">
              {result.columns.length > 0 ? (
                <>
                  <span className="font-mono text-foreground">
                    {result.durationMs} ms
                  </span>
                  <span>·</span>
                  <span>
                    {result.rows.length.toLocaleString()} row
                    {result.rows.length === 1 ? "" : "s"}
                  </span>
                  <div className="ml-auto">
                    <ExportMenu onExport={exportResults} />
                  </div>
                </>
              ) : (
                <>
                  <span className="rounded bg-surface px-2 py-0.5 font-mono text-foreground">
                    {result.command || "OK"}
                    {result.rowCount ? ` ${result.rowCount}` : ""}
                  </span>
                  <span className="font-mono">{result.durationMs} ms</span>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            Run a query to see results.
          </div>
        )}
      </div>

      {/* history dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Query history</DialogTitle>
            <DialogDescription>
              Click an entry to load it into the editor.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto">
            {history.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">No history yet.</p>
            ) : (
              history.map((h, i) => (
                <button
                  // Query history has no id; a timestamp can repeat within a
                  // millisecond, so position is part of the identity.
                  // oxlint-disable-next-line react/no-array-index-key
                  key={`${h.ts}-${i}`}
                  type="button"
                  onClick={() => {
                    setText(h.text);
                    setHistoryOpen(false);
                  }}
                  className="block w-full border-b border-border px-2 py-2 text-left hover:bg-surface"
                >
                  <pre className="truncate font-mono text-xs text-foreground">
                    {h.text}
                  </pre>
                  <span className="text-[11px] text-muted">
                    {new Date(h.ts).toLocaleString()} · {h.durationMs} ms
                  </span>
                </button>
              ))
            )}
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void clearHistory()}
              disabled={history.length === 0}
            >
              Clear history
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
