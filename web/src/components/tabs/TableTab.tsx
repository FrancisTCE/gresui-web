// Table tab: FilterBar + toolbar + DataGrid + RowJsonPane + dialogs.
import { EyeOff, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  BrowseResponse,
  CellValue,
  CountMode,
  TableInfo,
} from "../../../../shared/types.ts";
import { useAppStore } from "@/AppStore.tsx";
import { useMcpActivity } from "@/McpStore.tsx";
import { ErrorBanner } from "@/components/ErrorBanner.tsx";
import { NoTableSelected } from "@/screens/MainShell.tsx";
import { InsertRowDialog } from "@/components/dialogs/InsertRowDialog.tsx";
import { DataGrid, type SortState } from "@/components/grid/DataGrid.tsx";
import { FilterBar } from "@/components/grid/FilterBar.tsx";
import { RowJsonPane } from "@/components/grid/RowJsonPane.tsx";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { qualifiedTable } from "@/lib/mcp-scope.ts";
import { call, getBindings } from "@/lib/rpc.ts";

/** Identity of a row count: the relation plus the filter it was taken under. */
function countKey(target: string, filter: string): string {
  return `${target}\u0000${filter.trim()}`;
}

export function TableTab({ tabActive }: { tabActive: boolean }) {
  const { active, toastStore, setViewStatus } = useAppStore();
  // Null when the MCP store is not mounted (no connection) — the grid simply
  // does not flash then.
  const mcpActivity = useMcpActivity();

  const [data, setData] = useState<BrowseResponse | null>(null);
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonHeight, setJsonHeight] = useState(220);
  const [jsonRowIdx, setJsonRowIdx] = useState<number | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [countMode, setCountMode] = useState<CountMode>("auto");
  /** An exact count the user paid for, kept for as long as it stays true —
   * i.e. until the relation or the filter changes. Without this, "Count
   * exactly" would re-run the full scan on every subsequent page turn. */
  const [pinnedCount, setPinnedCount] = useState<
    { key: string; total: number } | null
  >(null);
  const isMounted = useRef(true);
  const prevKey = useRef<string | null>(null);
  /** Serialized shape of the last dispatched request — collapses the duplicate
   * fetch that a table switch used to cause (reset page/filter/sort re-ran the
   * effect with the values load() had already applied). */
  const lastReq = useRef<string>("");
  /** Only the newest request may write state; a slow count on a big table
   * would otherwise land after the user had already moved on. */
  const reqSeq = useRef(0);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!active) return;
    // schema belongs in the identity: two schemas routinely hold a table of
    // the same name, and switching between them must reset filter/sort/page.
    const key = `${active.database}:${active.schema}:${active.table}`;
    const switched = prevKey.current !== key;
    if (switched) prevKey.current = key;
    const effPage = switched ? 0 : page;
    const effFilter = switched ? "" : filter;
    const effSort = switched ? null : sort;
    const effCount = switched ? "auto" : countMode;
    if (switched) {
      setPage(0);
      setFilter("");
      setSort(null);
      setCountMode("auto");
      setPinnedCount(null);
      setData(null);
      setTableInfo(null);
      setJsonRowIdx(null);
      setJsonOpen(false);
    }

    const req = JSON.stringify([key, effPage, effFilter, effSort, effCount, pageSize, tick]);
    if (req === lastReq.current) return; // the reset above already asked for this
    lastReq.current = req;
    const seq = ++reqSeq.current;
    const fresh = () => isMounted.current && seq === reqSeq.current;

    setLoading(true);
    setError("");
    const startedAt = performance.now();
    try {
      const b = getBindings();
      const [browse, info] = await Promise.all([
        call(
          b.browse(active.database, {
            schema: active.schema,
            table: active.table,
            where: effFilter || undefined,
            orderBy: effSort ?? undefined,
            limit: pageSize,
            offset: effPage * pageSize,
            countMode: effCount,
          }),
        ),
        call(b.getTableInfo(active.database, active.schema, active.table)),
      ]);
      if (!fresh()) return;
      const elapsedMs = performance.now() - startedAt;
      setData(browse);
      setTableInfo(info);
      setViewStatus({
        rows: browse.rows.length,
        total: browse.total,
        estimated: browse.estimated,
        elapsedMs,
      });
      setSelected(new Set());
      setJsonRowIdx(null);
      if (effCount === "exact") {
        setPinnedCount({ key: countKey(key, effFilter), total: browse.total });
        setCountMode("auto");
      }
    } catch (e) {
      if (fresh()) {
        setError((e as Error).message);
        setViewStatus({ label: "Query failed" });
      }
    } finally {
      if (fresh()) setLoading(false);
    }
  }, [active, filter, sort, page, pageSize, tick, countMode, setViewStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!tabActive) return;
    return () => setViewStatus({});
  }, [tabActive, setViewStatus]);

  const targetKey = active
    ? `${active.database}:${active.schema}:${active.table}`
    : "";
  // A count is only valid for the relation *and* the filter it was taken under.
  const pinValid = pinnedCount !== null &&
    pinnedCount.key === countKey(targetKey, filter);
  const total = pinValid ? pinnedCount.total : (data?.total ?? 0);
  const estimated = pinValid ? false : (data?.estimated ?? false);

  const readOnly =
    !tableInfo || tableInfo.pkColumns.length === 0 || active?.kind === "v" ||
    active?.kind === "m" || active?.kind === "f";

  const readOnlyReason =
    active?.kind === "v"
      ? "This is a view — read-only."
      : active?.kind === "m"
      ? "Materialized view — read-only."
      : active?.kind === "f"
      ? "Foreign table — read-only."
      : "Read-only: no primary key";

  async function commitCell(
    row: CellValue[],
    colName: string,
    value: CellValue,
  ): Promise<void> {
    if (!active || !data || !tableInfo) return;
    try {
      const pkIdx = tableInfo.pkColumns.map((pk) =>
        data.columns.findIndex((c) => c.name === pk),
      );
      const pkValues = pkIdx.map((i) => row[i] ?? null);
      await call(
        getBindings().updateRow(
          active.database,
          active.schema,
          active.table,
          tableInfo.pkColumns,
          pkValues,
          { [colName]: value },
        ),
      );
      toastStore.toast({ title: "Row updated" });
      refetch();
    } catch (e) {
      toastStore.toast({
        title: "Update failed",
        description: (e as Error).message,
        variant: "destructive",
      });
      refetch(); // revert the cell display
    }
  }

  async function deleteSelected(): Promise<void> {
    if (!active || !data || !tableInfo || selected.size === 0) return;
    setDeleteOpen(false);
    try {
      const pkIdx = tableInfo.pkColumns.map((pk) =>
        data.columns.findIndex((c) => c.name === pk),
      );
      const rows = [...selected].map((i) =>
        pkIdx.map((j) => data.rows[i]?.[j] ?? null)
      );
      const n = await call(
        getBindings().deleteRows(
          active.database,
          active.schema,
          active.table,
          tableInfo.pkColumns,
          rows,
        ),
      );
      toastStore.toast({
        title: `${n} row${n === 1 ? "" : "s"} deleted`,
      });
      setSelected(new Set());
      refetch();
    } catch (e) {
      toastStore.toast({
        title: "Delete failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  }

  async function insertRow(values: Record<string, CellValue>): Promise<void> {
    if (!active) return;
    await call(getBindings().insertRow(active.database, active.schema, active.table, values));
    toastStore.toast({ title: "Row inserted" });
    setPage(0);
    refetch();
  }

  /** Force a round trip past the request-dedupe guard. */
  function refetch(): void {
    lastReq.current = "";
    setPinnedCount(null); // the row count may have moved too
    setTick((t) => t + 1);
  }

  function applyFilter(f: string): void {
    setPage(0);
    setFilter(f);
  }

  /** Right-click preset filters: replace the WHERE, or AND-append it. */
  function quickFilter(clause: string, mode: "replace" | "append" = "replace"): void {
    setPage(0);
    setFilter(
      mode === "append" && filter.trim()
        ? `(${filter.trim()}) AND ${clause}` // parens keep precedence with user clauses like `a OR b`
        : clause,
    );
  }

  async function exportTable(format: ExportFormat): Promise<void> {
    if (!active) return;
    setExporting(true);
    try {
      const res = await call(
        getBindings().exportTable(active.database, {
          schema: active.schema,
          table: active.table,
          where: filter.trim() ? filter : undefined,
          orderBy: sort ?? undefined,
        }),
      );
      downloadExport(res.columns, res.rows, format, `${active.schema}.${active.table}`);
      toastStore.toast({
        title: `Exported ${res.rows.length.toLocaleString()} row${res.rows.length === 1 ? "" : "s"}`,
        description: res.truncated
          ? "Export capped at 100,000 rows — narrow the filter to export less."
          : undefined,
      });
    } catch (e) {
      toastStore.toast({
        title: "Export failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  }

  // keyboard shortcuts: Del → delete, Ctrl/Cmd+Shift+R → refresh.
  // Tabs stay mounted when hidden, so bail unless this tab is the active one —
  // otherwise Delete would pop the confirm dialog while editing SQL.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (!tabActive) return;
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      if (e.key === "Delete" && selected.size > 0 && !readOnly) {
        setDeleteOpen(true);
      } else if (
        (e.key === "R" || e.key === "r") && (e.ctrlKey || e.metaKey) && e.shiftKey
      ) {
        e.preventDefault();
        refetch();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, selected, readOnly, tabActive]);

  /** Row actions, rendered by FilterBar to the left of the pager. */
  function toolbar() {
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setInsertOpen(true)}
                disabled={readOnly || loading}
              >
                <Plus />
                New Row
              </Button>
            </span>
          </TooltipTrigger>
          {readOnly ? <TooltipContent>{readOnlyReason}</TooltipContent> : null}
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setDeleteOpen(true)}
                disabled={readOnly || selected.size === 0 || loading}
              >
                <Trash2 />
                Delete{selected.size > 0 ? ` (${selected.size})` : ""}
              </Button>
            </span>
          </TooltipTrigger>
          {readOnly ? <TooltipContent>{readOnlyReason}</TooltipContent> : null}
        </Tooltip>
        <Button
          size="sm"
          variant="secondary"
          onClick={refetch}
          disabled={loading}
          title="Refresh (Ctrl/Cmd+Shift+R)"
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
        <ExportMenu
          onExport={(f) => void exportTable(f)}
          disabled={loading || exporting || (data?.columns.length ?? 0) === 0}
          exporting={exporting}
        />
      </>
    );
  }

  if (!active) return <NoTableSelected />;

  // Rows an agent read from *this* relation in the last few seconds.
  const agentRows = mcpActivity?.reads(qualifiedTable(active));

  return (
    <div className="flex h-full flex-col bg-background">
      <FilterBar
        filter={filter}
        onApplyFilter={applyFilter}
        total={total}
        estimated={estimated}
        onExactCount={() => {
          lastReq.current = ""; // same page, different count mode
          setCountMode("exact");
        }}
        loading={loading}
        page={page}
        pageSize={pageSize}
        onPageSize={(s) => {
          setPage(0);
          setPageSize(s);
        }}
        onPageChange={setPage}
        columns={tableInfo?.columns ?? []}
        actions={toolbar()}
      />

      {error
        ? (
          <ErrorBanner
            message={error}
            className="m-2 max-h-32 shrink-0 overflow-auto"
          />
        )
        : null}

      {readOnly && tableInfo ? (
        <div className="flex items-center gap-2 border-b border-border bg-raised px-3 py-1 text-xs text-muted">
          <EyeOff className="size-3.5 shrink-0" />
          {readOnlyReason}
          <span className="ml-auto font-mono text-[11px] text-subtle">
            {tableInfo.schema}.{tableInfo.table} · {tableInfo.columns.length} columns
          </span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <DataGrid
          columns={data?.columns ?? []}
          rows={data?.rows ?? []}
          editable
          selectable
          loading={loading}
          emptyMessage={filter.trim()
            ? "No rows match the filter."
            : "This table is empty."}
          pkColumns={tableInfo?.pkColumns ?? []}
          sortState={sort}
          onSortChange={(s) => {
            setPage(0);
            setSort(s);
          }}
          agentRows={agentRows}
          onQuickFilter={quickFilter}
          onCommitCell={readOnly ? undefined : commitCell}
          selected={selected}
          onSelectionChange={setSelected}
          onRowClick={(_row, idx) => {
            setJsonRowIdx(idx);
            setJsonOpen(true);
          }}
          selectedRowIndex={jsonRowIdx}
          rowOffset={page * pageSize}
        />
      </div>

      <RowJsonPane
        open={jsonOpen}
        onToggle={() => setJsonOpen((v) => !v)}
        height={jsonHeight}
        onResize={setJsonHeight}
        columns={data?.columns ?? []}
        row={jsonRowIdx !== null ? (data?.rows[jsonRowIdx] ?? null) : null}
      />

      <InsertRowDialog
        open={insertOpen}
        onOpenChange={setInsertOpen}
        columns={tableInfo?.columns ?? []}
        onInsert={insertRow}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {selected.size} row{selected.size === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>
              This permanently removes the selected rows from{" "}
              <span className="font-mono">
                {active.schema}.{active.table}
              </span>
              .
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void deleteSelected()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
