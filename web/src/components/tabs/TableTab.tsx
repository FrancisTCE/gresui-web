// Table tab: FilterBar + toolbar + DataGrid + RowJsonPane + dialogs.
import { EyeOff, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  BrowseResponse,
  CellValue,
  TableInfo,
} from "../../../../shared/types.ts";
import { useAppStore } from "@/AppStore.tsx";
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
import { call, getBindings } from "@/lib/rpc.ts";

export function TableTab({ tabActive }: { tabActive: boolean }) {
  const { active, toastStore } = useAppStore();

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
  const isMounted = useRef(true);
  const prevKey = useRef<string | null>(null);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!active) return;
    const key = `${active.database}:${active.table}`;
    const switched = prevKey.current !== key;
    if (switched) prevKey.current = key;
    const effPage = switched ? 0 : page;
    const effFilter = switched ? "" : filter;
    const effSort = switched ? null : sort;
    if (switched) {
      setPage(0);
      setFilter("");
      setSort(null);
      setData(null);
      setTableInfo(null);
      setJsonRowIdx(null);
      setJsonOpen(false);
    }
    setLoading(true);
    setError("");
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
          }),
        ),
        call(b.getTableInfo(active.database, active.schema, active.table)),
      ]);
      if (!isMounted.current) return;
      setData(browse);
      setTableInfo(info);
      setSelected(new Set());
      setJsonRowIdx(null);
    } catch (e) {
      if (isMounted.current) setError((e as Error).message);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, [active, filter, sort, page, pageSize, tick]);

  useEffect(() => {
    void load();
  }, [load]);

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
      await load();
    } catch (e) {
      toastStore.toast({
        title: "Update failed",
        description: (e as Error).message,
        variant: "destructive",
      });
      await load(); // revert the cell display
    }
  }

  async function deleteSelected(): Promise<void> {
    if (!active || !data || !tableInfo || selected.size === 0) return;
    setDeleteOpen(false);
    try {
      const pkIdx = tableInfo.pkColumns.map((pk) =>
        data.columns.findIndex((c) => c.name === pk),
      );
      const rows = [...selected].map((i) => pkIdx.map((j) => data!.rows[i][j] ?? null));
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
      await load();
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
    await load();
  }

  function applyFilter(f: string): void {
    setPage(0);
    setFilter(f);
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
      } else if (e.key === "R" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        setTick((t) => t + 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, selected, readOnly]);

  if (!active) return <NoTableSelected />;

  return (
    <div className="flex h-full flex-col bg-background">
      <FilterBar
        filter={filter}
        onApplyFilter={applyFilter}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPageSize={(s) => {
          setPage(0);
          setPageSize(s);
        }}
        onPageChange={setPage}
        truncated={data?.truncated ?? false}
        columns={tableInfo?.columns ?? []}
      />

      {error ? (
        <ErrorBanner message={error} className="m-2" />
      ) : null}

      {readOnly && tableInfo ? (
        <div className="flex items-center gap-2 border-b border-border bg-raised px-3 py-1.5 text-xs text-muted">
          <EyeOff className="size-3.5" />
          {readOnlyReason}
        </div>
      ) : null}

      {/* toolbar */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-raised px-2 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setInsertOpen(true)}
              disabled={readOnly || loading}
            >
              <Plus />
              New Row
            </Button>
          </TooltipTrigger>
          {readOnly ? <TooltipContent>{readOnlyReason}</TooltipContent> : null}
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDeleteOpen(true)}
              disabled={readOnly || selected.size === 0 || loading}
            >
              <Trash2 />
              Delete{selected.size > 0 ? ` (${selected.size})` : ""}
            </Button>
          </TooltipTrigger>
          {readOnly ? <TooltipContent>{readOnlyReason}</TooltipContent> : null}
        </Tooltip>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setTick((t) => t + 1)}
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
        <span className="ml-auto pr-1 text-xs text-muted">
          {tableInfo
            ? `${tableInfo.schema}.${tableInfo.table} — ${tableInfo.columns.length} columns`
            : ""}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        <DataGrid
          columns={data?.columns ?? []}
          rows={data?.rows ?? []}
          editable
          selectable
          pkColumns={tableInfo?.pkColumns ?? []}
          sortState={sort}
          onSortChange={(s) => {
            setPage(0);
            setSort(s);
          }}
          onCommitCell={readOnly ? undefined : commitCell}
          selected={selected}
          onSelectionChange={setSelected}
          onRowClick={(_row, idx) => {
            setJsonRowIdx(idx);
            setJsonOpen(true);
          }}
          selectedRowIndex={jsonRowIdx}
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
