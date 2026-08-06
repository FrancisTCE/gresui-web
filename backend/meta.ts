// Catalog queries — always parameterized; `to_regclass($1)` is injection-safe
// for the `"schema"."table"` string.

import type {
  ColumnInfo,
  IndexInfo,
  RelationInfo,
  TableInfo,
} from "../../shared/types.ts";
import { quoteIdent, type PgSession } from "./pg.ts";

const regclassParam = (schema: string, table: string) =>
  quoteIdent([schema, table]);

export async function listDatabases(s: PgSession): Promise<string[]> {
  const res = await s.query(
    "SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn ORDER BY datname",
  );
  return res.rows.map((r) => String(r[0]));
}

export async function listSchemas(s: PgSession): Promise<string[]> {
  const res = await s.query(
    `SELECT DISTINCT n.nspname FROM pg_namespace n
     JOIN pg_class c ON c.relnamespace = n.oid
     WHERE n.nspname NOT LIKE 'pg\\_%'
       AND n.nspname <> 'information_schema'
       AND c.relkind IN ('r','p','v','m','f')
     ORDER BY 1`,
  );
  return res.rows.map((r) => String(r[0]));
}

export async function listRelations(
  s: PgSession,
  schema: string,
): Promise<RelationInfo[]> {
  const res = await s.query(
    `SELECT c.relname, c.relkind::text FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind IN ('r','p','v','m','f')
     ORDER BY c.relname`,
    [schema],
  );
  return res.rows.map((r) => ({
    name: String(r[0]),
    kind: r[1] as RelationInfo["kind"],
  }));
}

async function listColumns(
  s: PgSession,
  schema: string,
  table: string,
): Promise<Omit<ColumnInfo, "isPk">[]> {
  const res = await s.query(
    `SELECT a.attname,
            format_type(a.atttypid, a.atttypmod) AS type,
            a.attnotnull,
            pg_get_expr(d.adbin, d.adrelid) IS NOT NULL AS has_default
     FROM pg_attribute a
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`,
    [regclassParam(schema, table)],
  );
  return res.rows.map((r, i) => ({
    name: String(r[0]),
    type: String(r[1]),
    notNull: r[2] === true,
    hasDefault: r[3] === true,
    ordinal: i + 1,
  }));
}

async function listPkColumns(
  s: PgSession,
  schema: string,
  table: string,
): Promise<string[]> {
  const res = await s.query(
    `SELECT a.attname
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = to_regclass($1) AND i.indisprimary
     ORDER BY array_position(i.indkey, a.attnum)`,
    [regclassParam(schema, table)],
  );
  return res.rows.map((r) => String(r[0]));
}

async function rowEstimate(
  s: PgSession,
  schema: string,
  table: string,
): Promise<number | null> {
  const res = await s.query(
    "SELECT reltuples::bigint FROM pg_class WHERE oid = to_regclass($1)",
    [regclassParam(schema, table)],
  );
  const v = res.rows[0]?.[0];
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return n < 0 ? null : n;
}

export async function getTableInfo(
  s: PgSession,
  schema: string,
  table: string,
): Promise<TableInfo> {
  const [cols, pks, estimate] = await Promise.all([
    listColumns(s, schema, table),
    listPkColumns(s, schema, table),
    rowEstimate(s, schema, table),
  ]);
  const pkSet = new Set(pks);
  return {
    schema,
    table,
    columns: cols.map((c) => ({ ...c, isPk: pkSet.has(c.name) })),
    pkColumns: pks,
    rowEstimate: estimate,
  };
}

export async function listIndexes(
  s: PgSession,
  schema: string,
  table: string,
): Promise<IndexInfo[]> {
  const res = await s.query(
    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname",
    [schema, table],
  );
  return res.rows.map((r) => ({
    name: String(r[0]),
    unique: String(r[1]).includes("CREATE UNIQUE INDEX"),
    definition: String(r[1]),
  }));
}

/** Exact row count. */
export async function getRowCount(
  s: PgSession,
  schema: string,
  table: string,
): Promise<number> {
  const res = await s.query(
    `SELECT count(*)::text FROM ${quoteIdent([schema, table])}`,
  );
  return Number(res.rows[0]?.[0] ?? 0);
}
