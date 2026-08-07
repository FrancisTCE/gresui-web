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
import { cn } from "@/lib/utils.ts";
import { call, getBindings } from "@/lib/rpc.ts";

const PLACEHOLDER = `-- Ctrl/Cmd+Enter to run
SELECT * FROM app.users LIMIT 50;`;

export function SqlTab() {
  const { theme, toastStore } = useAppStore();
  const [text, setText] = useState(PLACEHOLDER);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [explain, setExplain] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [editorH, setEditorH] = useState(240);
  const dragRef = useRef(false);

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

  async function cancel(): Promise<void> {
    try {
      await call(getBindings().cancelQuery());
    } catch {
      // ignore
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
    dragRef.current = true;
    const startY = e.clientY;
    const startH = editorH;
    const onMove = (ev: PointerEvent): void => {
      // editor grows downward; parent is the tab content area
      const parent = (ev.target as HTMLElement).closest(".sql-root") as HTMLElement | null;
      const max = parent ? parent.clientHeight - 120 : 600;
      setEditorH(Math.min(max, Math.max(90, startH + (ev.clientY - startY))));
    };
    const onUp = (): void => {
      dragRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void run();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, running, explain]);

  const isExplain = explain && result !== null && result.command === "EXPLAIN";

  return (
    <div className="sql-root flex h-full flex-col bg-background">
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
          <div className="p-2">
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
                <span
                  className={cn(
                    "rounded bg-surface px-2 py-0.5 font-mono text-foreground",
                    result.command.startsWith("ERROR") && "text-danger",
                  )}
                >
                  {result.command || "OK"} {result.rowCount}
                </span>
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
