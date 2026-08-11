// Row data operations: browse, insert, update, delete.
// Identifiers are quoteIdent-quoted; values are always parameterized.
// `where` filters are raw user SQL spliced verbatim — intentional editor
// semantics (Compass parity), same trust level as the SQL tab.

import type {
  BrowseRequest,
  BrowseResponse,
  CellValue,
  ExportRequest,
  ExportResponse,
  Row,
} from "../../shared/types.ts";
import { quoteIdent, type PgSession } from "./pg.ts";

export const BROWSE_CAP = 10_000;
export const EXPORT_CAP = 100_000;

/** Shared WHERE/ORDER BY suffix for browse and export. */
function whereOrderSql(
  where?: string,
  orderBy?: { column: string; dir: "asc" | "desc" },
): string {
  const w = where && where.trim() ? ` WHERE ${where}` : "";
  const o = orderBy
    ? ` ORDER BY ${quoteIdent([orderBy.column])} ${orderBy.dir === "desc" ? "DESC" : "ASC"}`
    : "";
  return w + o;
}

export async function browse(
  s: PgSession,
  req: BrowseRequest,
): Promise<BrowseResponse> {
  const q = quoteIdent([req.schema, req.table]);
  const whereOrder = whereOrderSql(req.where, req.orderBy);
  const limit = Math.min(Math.max(1, req.limit || 50), BROWSE_CAP);
  const offset = Math.max(0, Number(req.offset) || 0);

  const [data, count] = await Promise.all([
    s.query(
      `SELECT * FROM ${q}${whereOrder} LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    // count() ignores ORDER BY — including it makes the aggregate query invalid
    // (`column must appear in the GROUP BY clause`).
    s.query(`SELECT count(*)::text FROM ${q}${whereOrderSql(req.where)}`),
  ]);

  return {
    columns: data.columns,
    rows: data.rows,
    total: Number(count.rows[0]?.[0] ?? 0),
    truncated: limit >= BROWSE_CAP,
  };
}

export async function exportTable(
  s: PgSession,
  req: ExportRequest,
): Promise<ExportResponse> {
  const q = quoteIdent([req.schema, req.table]);
  const cap = Math.min(Math.max(1, req.maxRows || EXPORT_CAP), EXPORT_CAP);
  const res = await s.query(
    `SELECT * FROM ${q}${whereOrderSql(req.where, req.orderBy)} LIMIT $1`,
    [cap + 1],
  );
  const truncated = res.rows.length > cap;
  return {
    columns: res.columns,
    rows: truncated ? res.rows.slice(0, cap) : res.rows,
    truncated,
  };
}

export async function insertRow(
  s: PgSession,
  schema: string,
  table: string,
  values: Record<string, CellValue>,
): Promise<Row> {
  const keys = Object.keys(values);
  if (keys.length === 0) throw new Error("No values to write");
  const q = quoteIdent([schema, table]);
  const cols = keys.map((k) => quoteIdent([k])).join(", ");
  const ph = keys.map((_, i) => `$${i + 1}`).join(", ");
  const res = await s.query(
    `INSERT INTO ${q} (${cols}) VALUES (${ph}) RETURNING *`,
    keys.map((k) => values[k]),
  );
  if (!res.rows[0]) throw new Error("Insert returned no row");
  return res.rows[0];
}

export async function updateRow(
  s: PgSession,
  schema: string,
  table: string,
  pkColumns: string[],
  pkValues: CellValue[],
  changes: Record<string, CellValue>,
): Promise<Row> {
  if (pkColumns.length === 0) {
    throw new Error("Table has no primary key — row editing is disabled");
  }
  const keys = Object.keys(changes);
  if (keys.length === 0) throw new Error("No values to write");
  const q = quoteIdent([schema, table]);
  const setSql = keys.map((k, i) => `${quoteIdent([k])} = $${i + 1}`).join(", ");
  const whereSql = pkColumns
    .map((pk, i) => `${quoteIdent([pk])} = $${keys.length + i + 1}`)
    .join(" AND ");
  const res = await s.query(
    `UPDATE ${q} SET ${setSql} WHERE ${whereSql} RETURNING *`,
    [...keys.map((k) => changes[k]), ...pkValues],
  );
  if (!res.rows[0]) throw new Error("Row not found");
  return res.rows[0];
}

export async function deleteRows(
  s: PgSession,
  schema: string,
  table: string,
  pkColumns: string[],
  rows: CellValue[][],
): Promise<number> {
  if (pkColumns.length === 0) {
    throw new Error("Table has no primary key — row editing is disabled");
  }
  if (rows.length === 0) throw new Error("No values to write");
  const q = quoteIdent([schema, table]);
  const per = pkColumns.length;
  const clauses = rows
    .map((r, ri) =>
      `(${pkColumns
        .map((pk, pi) => `${quoteIdent([pk])} = $${ri * per + pi + 1}`)
        .join(" AND ")})`
    )
    .join(" OR ");
  const res = await s.query(
    `DELETE FROM ${q} WHERE ${clauses}`,
    rows.flat(),
  );
  return res.rowCount;
}
