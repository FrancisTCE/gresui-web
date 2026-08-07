// DataGrid — virtualized table (react-table column model + react-virtual rows).
// Editable mode adds selection + inline cell editing + sorting; SQL results
// reuse it in read-only mode.
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Check, ChevronsUpDown } from "lucide-react";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { CellValue, Row } from "../../../../shared/types.ts";
import { cn } from "@/lib/utils.ts";

export interface GridColumn {
  name: string;
  type: string;
}

export interface SortState {
  column: string;
  dir: "asc" | "desc";
}

export interface DataGridProps {
  columns: GridColumn[];
  rows: Row[];
  /** Editable mode: selection + inline edit + sort. SQL results pass false. */
  editable?: boolean;
  pkColumns?: string[];
  /** Show the sticky checkbox column. */
  selectable?: boolean;
  sortState?: SortState | null;
  onSortChange?: (s: SortState | null) => void;
  onCommitCell?: (
    row: Row,
    column: string,
    value: CellValue,
  ) => Promise<void>;
  selected?: Set<number>;
  onSelectionChange?: (sel: Set<number>) => void;
  onRowClick?: (row: Row, index: number) => void;
  selectedRowIndex?: number | null;
  className?: string;
}

const ROW_H = 28;

const MONO_TYPES =
  /^(json|jsonb|bytea|uuid|timestamptz|timestamp|date|time|numeric|money|interval|int|int2|int4|int8|float|float4|float8|serial|bigserial)/;

function estimateWidth(name: string, type: string, samples: CellValue[]): number {
  const headerLen = name.length;
  let max = 0;
  for (const v of samples) {
    if (v === null) continue;
    const s = typeof v === "boolean" ? 4 : String(v).length;
    if (s > max) max = s;
  }
  const w = Math.max(headerLen, max) * 7.6 + 36;
  if (MONO_TYPES.test(type)) return Math.min(320, Math.max(140, w));
  return Math.min(320, Math.max(90, w));
}

export function DataGrid({
  columns,
  rows,
  editable = false,
  pkColumns = [],
  selectable = false,
  sortState = null,
  onSortChange,
  onCommitCell,
  selected,
  onSelectionChange,
  onRowClick,
  selectedRowIndex = null,
  className,
}: DataGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const widths = useMemo(() => {
    const samples = rows.slice(0, 100);
    const base = columns.map((c, i) =>
      estimateWidth(c.name, c.type, samples.map((r) => r[i] ?? null)),
    );
    const sum = base.reduce((a, b) => a + b, 0);
    if (viewW > sum && base.length > 0) {
      const scale = viewW / sum;
      return base.map((w) => Math.floor(w * scale));
    }
    return base;
  }, [columns, rows, viewW]);

  const totalW = widths.reduce((a, b) => a + b, 0) + (selectable ? 36 : 0);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  const [editing, setEditing] = useState<{ row: number; col: number } | null>(
    null,
  );
  const [editText, setEditText] = useState("");

  function startEdit(rowIdx: number, colIdx: number): void {
    if (!editable || !onCommitCell || !selectable) return;
    if (pkColumns.length === 0) return;
    const v = rows[rowIdx]?.[colIdx];
    setEditText(v === null ? "" : String(v));
    setEditing({ row: rowIdx, col: colIdx });
  }

  async function commitEdit(): Promise<void> {
    if (!editing) return;
    const { row, col } = editing;
    const colName = columns[col]?.name;
    const rowData = rows[row];
    if (!colName || !rowData || !onCommitCell) {
      setEditing(null);
      return;
    }
    const raw = editText;
    let value: CellValue = raw;
    if (raw === "") {
      // empty string → null unless the column type is text-ish; simplest: null,
      // DB constraint rejects when NOT NULL
      value = null;
    }
    setEditing(null);
    await onCommitCell(rowData, colName, value);
  }

  function cancelEdit(): void {
    setEditing(null);
  }

  function toggleRow(idx: number): void {
    if (!selected || !onSelectionChange) return;
    const next = new Set(selected);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    onSelectionChange(next);
  }

  function cycleSort(colIdx: number): void {
    if (!onSortChange) return;
    const name = columns[colIdx]?.name;
    if (!name) return;
    if (sortState?.column !== name) onSortChange({ column: name, dir: "asc" });
    else if (sortState.dir === "asc") onSortChange({ column: name, dir: "desc" });
    else onSortChange(null);
  }

  const gridTemplate = `${selectable ? "36px " : ""}${widths.map((w) => `${w}px`).join(" ")}`;

  return (
    <div
      ref={scrollRef}
      className={cn("relative h-full overflow-auto bg-background", className)}
    >
      {/* header */}
      <div
        className="sticky top-0 z-20 grid border-b border-border bg-raised text-xs font-medium text-muted"
        style={{ gridTemplateColumns: gridTemplate, minWidth: totalW }}
      >
        {selectable ? (
          <div className="flex items-center justify-center border-r border-border px-2 py-1">
            <button
              type="button"
              onClick={() => {
                if (!selected || !onSelectionChange) return;
                onSelectionChange(
                  selected.size === rows.length && rows.length > 0
                    ? new Set()
                    : new Set(rows.map((_, i) => i)),
                );
              }}
              className="flex size-4 items-center justify-center rounded border border-border bg-background text-accent-fg"
              aria-label="Select all"
            >
              {selected && selected.size === rows.length && rows.length > 0 ? (
                <Check className="size-3" />
              ) : null}
            </button>
          </div>
        ) : null}
        {columns.map((c, i) => {
          const sorted = sortState?.column === c.name;
          return (
            <div
              key={c.name}
              className={cn(
                "flex min-w-0 items-center gap-1.5 border-r border-border px-2 py-1",
                onSortChange && "cursor-pointer select-none hover:text-foreground",
                sorted && "text-accent",
              )}
              onClick={() => onSortChange && cycleSort(i)}
              title={onSortChange ? "Click to sort" : undefined}
            >
              <span className="truncate">{c.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted/70">
                {c.type}
              </span>
              <span className="ml-auto shrink-0">
                {sorted ? (
                  sortState?.dir === "asc" ? (
                    <ArrowUp className="size-3" />
                  ) : (
                    <ArrowDown className="size-3" />
                  )
                ) : onSortChange ? (
                  <ChevronsUpDown className="size-3 opacity-40" />
                ) : null}
              </span>
            </div>
          );
        })}
      </div>

      {/* virtual body */}
      <div className="relative" style={{ height: virtualizer.getTotalSize(), minWidth: totalW }}>
        {virtualizer.getVirtualItems().map((v) => {
          const row = rows[v.index];
          return (
            <div
              key={v.key}
              className={cn(
                "absolute left-0 right-0 grid border-b border-border/60 text-[13px]",
                "hover:bg-surface",
                (selectedRowIndex === v.index || selected?.has(v.index)) &&
                  "bg-accent/10",
              )}
              style={{
                top: 0,
                transform: `translateY(${v.start}px)`,
                height: ROW_H,
                gridTemplateColumns: gridTemplate,
              }}
              onDoubleClick={(e) => {
                const cell = (e.target as HTMLElement).closest("[data-col]") as
                  | HTMLElement
                  | null;
                if (cell?.dataset.col !== undefined) {
                  startEdit(v.index, Number(cell.dataset.col));
                }
              }}
              onClick={() => onRowClick?.(row, v.index)}
            >
              {selectable ? (
                <div className="flex items-center justify-center border-r border-border/60 px-2">
                  <input
                    type="checkbox"
                    checked={selected?.has(v.index) ?? false}
                    onChange={() => toggleRow(v.index)}
                    onClick={(e) => e.stopPropagation()}
                    className="size-3.5 accent-[var(--accent)]"
                  />
                </div>
              ) : null}
              {columns.map((c, i) => (
                <div
                  key={c.name}
                  data-col={i}
                  className={cn(
                    "min-w-0 truncate border-r border-border/60 px-2 py-1 leading-5",
                    i === widths.length - 1 && "border-r-0",
                    typeof row[i] === "number" && "text-right font-mono",
                  )}
                >
                  {editing?.row === v.index && editing.col === i ? (
                    <CellEditor
                      value={editText}
                      type={c.type}
                      onChange={setEditText}
                      onCommit={() => void commitEdit()}
                      onCancel={cancelEdit}
                    />
                  ) : (
                    <CellValueView value={row[i] ?? null} type={c.type} />
                  )}
                </div>
              ))}
            </div>
          );
        })}
        {rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted">
            No rows match the filter.
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Per-type cell rendering. */
function CellValueView({ value, type }: { value: CellValue; type: string }) {
  if (value === null) {
    return <span className="italic text-muted">null</span>;
  }
  if (typeof value === "boolean") {
    return <span>{String(value)}</span>;
  }
  if (typeof value === "number") {
    return <span className="font-mono">{value}</span>;
  }
  const s = value;
  if (MONO_TYPES.test(type)) {
    return (
      <span
        title={s}
        className="block truncate rounded bg-code px-1 font-mono text-[12px] text-accent"
      >
        {s}
      </span>
    );
  }
  return <span title={s} className="block truncate">{s}</span>;
}

const CellEditor = memo(function CellEditor({
  value,
  type,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  type: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  void type;
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit();
        else if (e.key === "Escape") onCancel();
      }}
      onBlur={onCommit}
      className="h-6 w-full rounded border border-accent bg-background px-1 font-mono text-[12px] text-foreground focus:outline-none"
    />
  );
});
