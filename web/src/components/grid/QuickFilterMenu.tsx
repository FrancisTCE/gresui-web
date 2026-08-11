// QuickFilterMenu — right-click preset filters for grid cells and headers.
// Both components render ContextMenuItem / ContextMenuSeparator children and
// are meant to sit inside a ContextMenuContent. Item rows: friendly label
// left, truncated mono clause right; the full clause goes into onClick.
import type { JSX } from "react";

import type { CellValue } from "../../../../shared/types.ts";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu.tsx";
import type { GridColumn, SortState } from "./DataGrid.tsx";
import { columnKind, quoteIdent, sqlLiteral } from "./filter-ops.ts";

export interface FilterItem {
  label: string;
  clause: string;
  kind?: "sep";
}

/** Escape LIKE/ILIKE wildcards and the SQL quote in a literal so a raw %,
 * _, ', or \ in the value cannot act as a pattern; the clause must then
 * carry `ESCAPE '\'`. Backslash first so the escapes we insert for %/_ are
 * not re-escaped. */
function likePattern(v: string): string {
  return v
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "''")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

/** Pure item builder for the cell menu (exported for verification). */
export function cellFilterItems(
  column: GridColumn,
  value: CellValue,
): FilterItem[] {
  const q = quoteIdent(column.name);
  if (value === null) {
    return [
      { label: "Filter nulls", clause: `${q} IS NULL` },
      { kind: "sep", label: "", clause: "" },
      { label: "Filter non-nulls", clause: `${q} IS NOT NULL` },
    ];
  }
  const kind = columnKind(column.type);
  if (kind === "bool") {
    return [
      { label: "Filter by true", clause: `${q} = true` },
      { label: "Filter by false", clause: `${q} = false` },
      { kind: "sep", label: "", clause: "" },
      { label: "Exclude value", clause: `${q} != ${sqlLiteral(value)}` },
    ];
  }
  const lit = sqlLiteral(value);
  if (kind === "num" || kind === "date") {
    return [
      { label: "Filter by value", clause: `${q} = ${lit}` },
      { label: "Exclude value", clause: `${q} != ${lit}` },
      { kind: "sep", label: "", clause: "" },
      { label: "Greater than", clause: `${q} > ${lit}` },
      { label: "Less than", clause: `${q} < ${lit}` },
    ];
  }
  // text
  const p = likePattern(String(value));
  return [
    { label: "Filter by value", clause: `${q} = ${lit}` },
    { label: "Exclude value", clause: `${q} != ${lit}` },
    { kind: "sep", label: "", clause: "" },
    { label: "Contains", clause: `${q} ILIKE '%${p}%' ESCAPE '\\'` },
    { label: "Starts with", clause: `${q} ILIKE '${p}%' ESCAPE '\\'` },
  ];
}

/** Clause that selects the clicked cell itself — used by the append item. */
function matchClause(column: GridColumn, value: CellValue): string {
  const q = quoteIdent(column.name);
  return value === null ? `${q} IS NULL` : `${q} = ${sqlLiteral(value)}`;
}

/** Row of items: label left, truncated clause right. */
function ClauseItem({
  label,
  clause,
  onClick,
}: {
  label: string;
  clause: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <ContextMenuItem onClick={onClick}>
      <span>{label}</span>
      <span className="ml-auto truncate font-mono text-[10px] text-muted">
        {clause}
      </span>
    </ContextMenuItem>
  );
}

export function CellFilterMenu({
  column,
  value,
  onQuickFilter,
}: {
  column: GridColumn;
  value: CellValue;
  onQuickFilter: (clause: string, mode?: "replace" | "append") => void;
}): JSX.Element {
  const items = cellFilterItems(column, value);
  const appendClause = matchClause(column, value);
  return (
    <>
      {items.map((it, idx) =>
        it.kind === "sep" ? (
          <ContextMenuSeparator key={idx} />
        ) : (
          <ClauseItem
            key={idx}
            label={it.label}
            clause={it.clause}
            onClick={() => onQuickFilter(it.clause)}
          />
        ),
      )}
      <ContextMenuSeparator />
      <ClauseItem
        label="Add to filter (AND)"
        clause={appendClause}
        onClick={() => onQuickFilter(appendClause, "append")}
      />
    </>
  );
}

export function HeaderFilterMenu({
  column,
  sortState,
  onSortChange,
  onQuickFilter,
}: {
  column: GridColumn;
  sortState: SortState | null;
  onSortChange: (s: SortState | null) => void;
  onQuickFilter: (clause: string) => void;
}): JSX.Element {
  const sorted = sortState?.column === column.name;
  const bool = columnKind(column.type) === "bool";
  const q = quoteIdent(column.name);
  return (
    <>
      <ContextMenuItem
        disabled={sorted && sortState?.dir === "asc"}
        onClick={() => onSortChange({ column: column.name, dir: "asc" })}
      >
        Sort ascending
      </ContextMenuItem>
      <ContextMenuItem
        disabled={sorted && sortState?.dir === "desc"}
        onClick={() => onSortChange({ column: column.name, dir: "desc" })}
      >
        Sort descending
      </ContextMenuItem>
      <ContextMenuItem disabled={!sorted} onClick={() => onSortChange(null)}>
        Clear sort
      </ContextMenuItem>
      <ContextMenuSeparator />
      {bool ? (
        <>
          <ClauseItem
            label="Filter by true"
            clause={`${q} = true`}
            onClick={() => onQuickFilter(`${q} = true`)}
          />
          <ClauseItem
            label="Filter by false"
            clause={`${q} = false`}
            onClick={() => onQuickFilter(`${q} = false`)}
          />
        </>
      ) : null}
      <ClauseItem
        label="Filter nulls"
        clause={`${q} IS NULL`}
        onClick={() => onQuickFilter(`${q} IS NULL`)}
      />
      <ClauseItem
        label="Filter non-nulls"
        clause={`${q} IS NOT NULL`}
        onClick={() => onQuickFilter(`${q} IS NOT NULL`)}
      />
    </>
  );
}
