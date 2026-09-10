// DataGrid — virtualized table (react-table column model + react-virtual rows).
// Editable mode adds selection + inline cell editing + sorting; SQL results
// reuse it in read-only mode.
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronsUpDown,
  Loader2,
  Minus,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.tsx";
import { isNumericType, MONO_TYPES, valueClass } from "@/lib/pg-types.ts";
import { cn } from "@/lib/utils.ts";
import { noop } from "../../../../shared/noop.ts";
import { rowKey } from "../../../../shared/row-key.ts";
import type { CellValue, Row } from "../../../../shared/types.ts";
import { CellFilterMenu, HeaderFilterMenu } from "./QuickFilterMenu.tsx";

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
  editable?: boolean | undefined;
  pkColumns?: string[] | undefined;
  /** Show the sticky checkbox column. */
  selectable?: boolean | undefined;
  sortState?: SortState | null | undefined;
  onSortChange?: ((s: SortState | null) => void) | undefined;
  /** Right-click preset filters (Table tab only). Absent → no context menus. */
  onQuickFilter?:
    | ((clause: string, mode?: "replace" | "append") => void)
    | undefined;
  onCommitCell?:
    | ((row: Row, column: string, value: CellValue) => Promise<void>)
    | undefined;
  selected?: Set<number> | undefined;
  onSelectionChange?: ((sel: Set<number>) => void) | undefined;
  onRowClick?: ((row: Row, index: number) => void) | undefined;
  selectedRowIndex?: number | null | undefined;
  /** Index of the first row on this page, so the gutter can number rows
   * absolutely rather than restarting at 1 on every page. */
  rowOffset?: number | undefined;
  /** rowKey() of rows an MCP agent read moments ago — those rows flash. Only
   * the Table tab passes this; SQL results have no relation to attribute to. */
  agentRows?: ReadonlySet<string> | undefined;
  /** Rows are being fetched — shows a spinner instead of an "empty" verdict. */
  loading?: boolean | undefined;
  /** Shown when there are no rows and nothing is loading. */
  emptyMessage?: string | undefined;
  className?: string | undefined;
}

const ROW_H = 28;
const GUTTER_W = 46;
const MIN_COL_W = 56;
/** Caps for stretching narrow result sets across a wide viewport. */
const MAX_STRETCH = 2.5;
const MAX_STRETCH_W = 420;

function estimateWidth(
  name: string,
  type: string,
  samples: CellValue[],
): number {
  const headerLen = name.length + type.length + 3;
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
  onQuickFilter,
  onCommitCell,
  selected,
  onSelectionChange,
  onRowClick,
  selectedRowIndex = null,
  agentRows,
  rowOffset = 0,
  loading = false,
  emptyMessage = "No rows.",
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

  // Widths the user has dragged, by column name. Cleared when the column set
  // changes — a width dragged for `rna` means nothing on the next table.
  const colKey = useMemo(() => columns.map((c) => c.name).join(""), [columns]);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  // `colKey` is the trigger: when the column set changes the dragged widths
  // are meaningless, so the body clears them without reading it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    setOverrides({});
  }, [colKey]);

  const widths = useMemo(() => {
    const samples = rows.slice(0, 100);
    const base = columns.map((c, i) =>
      estimateWidth(
        c.name,
        c.type,
        samples.map((r) => r[i] ?? null),
      ),
    );
    const sum = base.reduce((a, b) => a + b, 0);
    let out = base;
    if (viewW > sum + GUTTER_W && base.length > 0) {
      // Fill the viewport, but never stretch a column past MAX_STRETCH_W — a
      // 3-column result used to blow each column up to a third of the screen.
      const scale = Math.min((viewW - GUTTER_W) / sum, MAX_STRETCH);
      out = base.map((w) => Math.floor(Math.min(w * scale, MAX_STRETCH_W)));
    }
    // A dragged width always wins over the estimate, at any viewport size.
    return out.map((w, i) => {
      const name = columns[i]?.name;
      return (name === undefined ? undefined : overrides[name]) ?? w;
    });
  }, [columns, rows, viewW, overrides]);

  const totalW = widths.reduce((a, b) => a + b, 0) + GUTTER_W;

  // Where the primary key sits in this result. Absent — a projection without
  // it, or a relation that has none — means rows cannot be matched to what an
  // agent read, so nothing flashes rather than the wrong thing flashing.
  const pkIdx = useMemo(() => {
    if (!agentRows || agentRows.size === 0 || pkColumns.length === 0)
      return null;
    const idx = pkColumns.map((pk) => columns.findIndex((c) => c.name === pk));
    return idx.every((i) => i >= 0) ? idx : null;
  }, [agentRows, pkColumns, columns]);

  const wasRead = useCallback(
    (row: Row): boolean => {
      if (!pkIdx || !agentRows) return false;
      return agentRows.has(rowKey(pkIdx.map((i) => row[i] ?? null)));
    },
    [pkIdx, agentRows],
  );

  const startResize = useCallback(
    (e: React.PointerEvent, colIdx: number, currentW: number) => {
      e.preventDefault();
      e.stopPropagation();
      const name = columns[colIdx]?.name;
      if (!name) return;
      const startX = e.clientX;
      const onMove = (ev: PointerEvent): void => {
        setOverrides((o) => ({
          ...o,
          [name]: Math.max(
            MIN_COL_W,
            Math.round(currentW + (ev.clientX - startX)),
          ),
        }));
      };
      const onUp = (): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [columns],
  );

  /** Double-click a resizer: drop the override and go back to auto-fit. */
  const autoFit = useCallback(
    (colIdx: number) => {
      const name = columns[colIdx]?.name;
      if (!name) return;
      setOverrides((o) => {
        const next = { ...o };
        delete next[name];
        return next;
      });
    },
    [columns],
  );

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
    else if (sortState.dir === "asc")
      onSortChange({ column: name, dir: "desc" });
    else onSortChange(null);
  }

  const allSelected =
    !!selected && selected.size === rows.length && rows.length > 0;
  const gridTemplate = `${GUTTER_W}px ${widths.map((w) => `${w}px`).join(" ")}`;

  return (
    <div className={cn("relative h-full", className)}>
      {/* loading veil — the last page stays readable underneath but can never
          pass for fresh data (a slow count used to leave stale rows on screen) */}
      {loading ? (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-start justify-center bg-background/60 animate-fade-in">
          <span className="mt-16 flex items-center gap-2 rounded-full border border-border-strong bg-overlay px-3 py-1.5 text-xs text-muted shadow-md">
            <Loader2 className="size-3.5 animate-spin" />
            Loading…
          </span>
        </div>
      ) : null}
      <div ref={scrollRef} className="h-full overflow-auto bg-background">
        {/* header */}
        <div
          className="sticky top-0 z-20 grid select-none border-b border-border bg-raised text-xs font-medium text-muted"
          style={{ gridTemplateColumns: gridTemplate, minWidth: totalW }}
        >
          <div className="sticky left-0 z-10 flex items-center justify-center border-r border-border bg-raised px-2 py-1">
            {selectable ? (
              <button
                type="button"
                onClick={() => {
                  if (!selected || !onSelectionChange) return;
                  onSelectionChange(
                    allSelected ? new Set() : new Set(rows.map((_, i) => i)),
                  );
                }}
                disabled={rows.length === 0}
                className={cn(
                  "flex size-3.5 items-center justify-center rounded-xs border transition-colors",
                  selected && selected.size > 0
                    ? "border-accent bg-accent text-accent-fg"
                    : "border-border-strong bg-background hover:border-accent",
                  rows.length === 0 && "opacity-40",
                )}
                aria-label={allSelected ? "Clear selection" : "Select all rows"}
              >
                {selected && selected.size > 0 ? (
                  allSelected ? (
                    <Check className="size-3" />
                  ) : (
                    <Minus className="size-3" />
                  )
                ) : null}
              </button>
            ) : (
              <span className="text-[10px] text-subtle">#</span>
            )}
          </div>
          {columns.map((c, i) => {
            const sorted = sortState?.column === c.name;
            // numeric cells are right-aligned; the header follows them
            const numeric = isNumericType(c.type);
            const cell = (
              <div
                key={c.name}
                className={cn(
                  "group/h relative flex min-w-0 items-center gap-1.5 border-r border-border px-2 py-1",
                  onSortChange && "cursor-pointer hover:text-foreground",
                  sorted && "text-accent-text",
                )}
                onClick={() => onSortChange && cycleSort(i)}
                // Sorting was mouse-only. A header that sorts is a control,
                // so it takes focus and answers Enter/Space like one.
                onKeyDown={(e) => {
                  if (!onSortChange) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    cycleSort(i);
                  }
                }}
                role="columnheader"
                tabIndex={onSortChange ? 0 : undefined}
                aria-sort={
                  sorted
                    ? sortState?.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : onSortChange
                      ? "none"
                      : undefined
                }
                title={
                  onSortChange
                    ? `${c.name} · ${c.type} — click to sort`
                    : `${c.name} · ${c.type}`
                }
              >
                {/* numeric cells are right-aligned; push the label over to meet
                    them, keeping the name-then-type order every column uses */}
                <span className={cn("truncate", numeric && "ml-auto")}>
                  {c.name}
                </span>
                <span className="shrink-0 font-mono text-[10px] font-normal lowercase text-subtle">
                  {c.type}
                </span>
                <span className={cn("shrink-0", !numeric && "ml-auto")}>
                  {sorted ? (
                    sortState?.dir === "asc" ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3" />
                    )
                  ) : onSortChange ? (
                    <ChevronsUpDown className="size-3 opacity-0 transition-opacity group-hover/h:opacity-40" />
                  ) : null}
                </span>
                {/* Resizer sits on the seam and swallows the sort click.
                    Pointer-only: keyboard resizing would need the full
                    separator contract (aria-valuenow/min/max tracking the
                    live width), which is a feature rather than a lint fix.
                    The column can still be sorted and read from the
                    keyboard — only dragging is unavailable. */}
                {/* biome-ignore lint/a11y: see above */}
                <span
                  onPointerDown={(e) =>
                    startResize(e, i, widths[i] ?? MIN_COL_W)
                  }
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    autoFit(i);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${c.name}`}
                  aria-valuenow={widths[i] ?? MIN_COL_W}
                  aria-valuemin={MIN_COL_W}
                  title="Drag to resize · double-click to auto-fit"
                  className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize"
                >
                  <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors hover:bg-accent" />
                </span>
              </div>
            );
            return onQuickFilter ? (
              <ContextMenu key={c.name}>
                <ContextMenuTrigger asChild>{cell}</ContextMenuTrigger>
                <ContextMenuContent>
                  <HeaderFilterMenu
                    column={c}
                    sortState={sortState}
                    onSortChange={onSortChange ?? noop}
                    onQuickFilter={(clause) => onQuickFilter(clause)}
                  />
                </ContextMenuContent>
              </ContextMenu>
            ) : (
              cell
            );
          })}
        </div>

        {/* virtual body */}
        <div
          className="relative"
          style={{ height: virtualizer.getTotalSize(), minWidth: totalW }}
        >
          {virtualizer.getVirtualItems().map((v) => {
            const row = rows[v.index];
            // The virtualizer only ever asks for indices inside `rows`; this
            // is the guard that lets the row body index it without doubt.
            if (row === undefined) return null;
            const isSelected = selected?.has(v.index) ?? false;
            const isCursor = selectedRowIndex === v.index;
            const read = wasRead(row);
            return (
              // Clicking a row opens the JSON pane, and there is no keyboard
              // route to it yet. The right fix is arrow-key navigation across
              // a single tab stop, the way the grid pattern prescribes —
              // making every virtualised row its own tab stop would be worse
              // than the gap it closes. Tracked separately.
              // biome-ignore lint/a11y: see above
              <div
                key={v.key}
                className={cn(
                  "group/row absolute left-0 right-0 grid border-b border-border/50 text-[13px]",
                  isSelected || isCursor
                    ? "bg-accent-soft"
                    : // A read row keeps its own hover shade. The plain hover
                      // utility is emitted after bg-agent-read and would
                      // otherwise win, erasing the marker on exactly the row the
                      // pointer — and so the eye — is resting on.
                      read
                      ? "hover:bg-agent-read-hover"
                      : "hover:bg-surface/70",
                  // A selection the user made must stay legible, so an agent
                  // read only tints a row that is not already highlighted.
                  // The tint is static and the pulse is decorative: with
                  // reduced motion the row still shows as read.
                  read &&
                    !isSelected &&
                    !isCursor &&
                    "bg-agent-read animate-agent-read",
                )}
                title={read ? "An MCP agent read this row" : undefined}
                style={{
                  top: 0,
                  transform: `translateY(${v.start}px)`,
                  height: ROW_H,
                  gridTemplateColumns: gridTemplate,
                }}
                onDoubleClick={(e) => {
                  const cell = (e.target as HTMLElement).closest(
                    "[data-col]",
                  ) as HTMLElement | null;
                  if (cell?.dataset.col !== undefined) {
                    startEdit(v.index, Number(cell.dataset.col));
                  }
                }}
                onClick={() => onRowClick?.(row, v.index)}
              >
                {/* Gutter: row number, swapped for the checkbox on hover or
                    once the row is part of a selection. */}
                <div
                  className={cn(
                    "sticky left-0 z-10 flex items-center justify-center border-r px-2",
                    isSelected || isCursor
                      ? "border-border/50 bg-surface-active"
                      : "border-border/50 bg-background group-hover/row:bg-surface",
                  )}
                >
                  {isSelected ? (
                    <span
                      className="absolute inset-y-0 left-0 w-0.5 bg-accent"
                      aria-hidden
                    />
                  ) : null}
                  {selectable ? (
                    <>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(v.index)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select row ${rowOffset + v.index + 1}`}
                        className={cn(
                          "size-3.5 accent-[var(--accent)]",
                          !isSelected && "hidden group-hover/row:block",
                        )}
                      />
                      <span
                        className={cn(
                          "font-mono text-[11px] tabular-nums text-subtle",
                          isSelected ? "hidden" : "group-hover/row:hidden",
                        )}
                      >
                        {rowOffset + v.index + 1}
                      </span>
                    </>
                  ) : (
                    <span className="font-mono text-[11px] tabular-nums text-subtle">
                      {rowOffset + v.index + 1}
                    </span>
                  )}
                </div>
                {columns.map((c, i) => {
                  const cell = (
                    <div
                      key={c.name}
                      data-col={i}
                      className={cn(
                        "min-w-0 truncate border-r border-border/40 px-2 py-1 leading-5",
                        i === widths.length - 1 && "border-r-0",
                        isNumericType(c.type) && "text-right",
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
                  );
                  return onQuickFilter ? (
                    <ContextMenu key={c.name}>
                      <ContextMenuTrigger asChild>{cell}</ContextMenuTrigger>
                      <ContextMenuContent>
                        <CellFilterMenu
                          column={c}
                          value={row[i] ?? null}
                          onQuickFilter={onQuickFilter}
                        />
                      </ContextMenuContent>
                    </ContextMenu>
                  ) : (
                    cell
                  );
                })}
              </div>
            );
          })}
          {rows.length === 0 && !loading ? (
            <div className="p-10 text-center text-sm text-muted">
              {emptyMessage}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Per-type cell rendering. Colour carries the type; there is no chip, because
 * at 28px rows a background on every mono cell turns the grid into stripes. */
function CellValueView({ value, type }: { value: CellValue; type: string }) {
  const cls = valueClass(type, value);
  if (value === null) return <span className={cls}>null</span>;
  const s = typeof value === "boolean" ? String(value) : String(value);
  return (
    <span title={s} className={cn("block truncate", cls)}>
      {s}
    </span>
  );
}

// The inner name is what React DevTools shows for a memoised component, so
// it deliberately matches the binding: that is the point of the idiom.
// biome-ignore lint/suspicious/noShadow: see above
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
      className="h-6 w-full rounded border border-accent bg-background px-1 font-mono text-[12px] text-foreground outline-none"
    />
  );
});
