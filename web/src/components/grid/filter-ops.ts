// filter-ops — SQL fragment helpers for the grid's right-click preset filters.
// Fragments are spliced verbatim into the browse WHERE clause (backend/data.ts
// whereOrderSql), so they must be valid SQL. No frontend equivalent existed
// before; quoteIdent mirrors backend/pg.ts quoteIdent semantics.
import type { CellValue } from "../../../../shared/types.ts";

export const NUM_RE =
  /^(int|int2|int4|int8|smallint|integer|bigint|numeric|decimal|real|double|float|money|serial|bigserial)/;
export const BOOL_RE = /^bool(ean)?$/;
export const DATE_RE = /^(date|timestamp|timestamptz)/;

export type ColumnKind = "num" | "bool" | "date" | "text";

export function columnKind(type: string): ColumnKind {
  if (NUM_RE.test(type)) return "num";
  if (BOOL_RE.test(type)) return "bool";
  if (DATE_RE.test(type)) return "date";
  return "text";
}

/** Always-quoted identifier — same semantics as backend quoteIdent (pg.ts). */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** SQL literal for a non-null cell value. */
export function sqlLiteral(v: Exclude<CellValue, null>): string {
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") return String(v);
  return `'${v.replaceAll("'", "''")}'`;
}
