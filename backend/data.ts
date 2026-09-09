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

/** Above this planner estimate, count(*) is too slow to run on every page —
 * browse reports the estimate instead and the UI offers an exact count. */
export const EXACT_COUNT_MAX = 100_000;

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

/** Planner row estimate for the filtered relation. Costs a plan, not a scan —
 * milliseconds even on a 50M-row table, where count(*) takes ~20 seconds.
 * Returns null when the plan can't be read; callers fall back to an exact count. */
async function estimateCount(
  s: PgSession,
  q: string,
  where?: string,
): Promise<number | null> {
  const res = await s.query(
    `EXPLAIN (FORMAT JSON) SELECT 1 FROM ${q}${whereOrderSql(where)}`,
  );
  const raw = res.rows[0]?.[0];
  if (typeof raw !== "string") return null;
  try {
    // normalizeCell stringifies the json column back to text
    const plan = JSON.parse(raw) as [{ Plan?: { "Plan Rows"?: unknown } }];
    const n = plan[0]?.Plan?.["Plan Rows"];
    return typeof n === "number" && Number.isFinite(n) && n >= 0
      ? Math.round(n)
      : null;
  } catch {
    return null;
  }
}

async function exactCount(
  s: PgSession,
  q: string,
  where?: string,
): Promise<number> {
  // count() ignores ORDER BY — including it makes the aggregate query invalid
  // ("column must appear in the GROUP BY clause").
  const res = await s.query(`SELECT count(*)::text FROM ${q}${whereOrderSql(where)}`);
  return Number(res.rows[0]?.[0] ?? 0);
}

/** Total row count for the browse footer.
 *
 * "auto" asks the planner first and only pays for count(*) when the table is
 * small enough that it is nearly free. An unreadable plan (odd relation kinds,
 * permission quirks) falls back to the exact count so the number is never
 * silently wrong. */
async function countRows(
  s: PgSession,
  q: string,
  where: string | undefined,
  mode: "auto" | "exact",
): Promise<{ total: number; estimated: boolean }> {
  if (mode === "exact") {
    return { total: await exactCount(s, q, where), estimated: false };
  }
  let est: number | null = null;
  try {
    est = await estimateCount(s, q, where);
  } catch {
    // an invalid WHERE surfaces on the data query instead — fall through
    est = null;
  }
  if (est !== null && est > EXACT_COUNT_MAX) {
    return { total: est, estimated: true };
  }
  return { total: await exactCount(s, q, where), estimated: false };
}

export async function browse(
  s: PgSession,
  req: BrowseRequest,
): Promise<BrowseResponse> {
  const q = quoteIdent([req.schema, req.table]);
  const whereOrder = whereOrderSql(req.where, req.orderBy);
  const limit = Math.min(Math.max(1, req.limit || 50), BROWSE_CAP);
  const offset = Math.max(0, Number(req.offset) || 0);

  // Sequential, not Promise.all: the session holds a single connection, so
  // the count would queue behind the rows anyway, and rows-first keeps the
  // grid honest if the count path throws.
  const data = await s.query(
    `SELECT * FROM ${q}${whereOrder} LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  const count = await countRows(s, q, req.where, req.countMode ?? "auto");

  return {
    columns: data.columns,
    rows: data.rows,
    total: count.total,
    estimated: count.estimated,
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
