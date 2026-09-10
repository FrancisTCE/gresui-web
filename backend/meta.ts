// Catalog queries — always parameterized; `to_regclass($1)` is injection-safe
// for the `"schema"."table"` string.

import type {
  ColumnInfo,
  IndexInfo,
  RelationInfo,
  TableInfo,
} from "../shared/types.ts";
import { quoteIdent, type PgSession } from "./pg.ts";

const regclassParam = (schema: string, table: string) =>
  quoteIdent([schema, table]);

export async function listDatabases(s: PgSession): Promise<string[]> {
  // has_database_privilege: listing databases the connected role cannot CONNECT
  // to only offers choices that fail on selection — on a stock server
  // "postgres" itself is usually one of them.
  const res = await s.query(
    `SELECT datname FROM pg_database
     WHERE datistemplate = false
       AND datallowconn
       AND has_database_privilege(datname, 'CONNECT')
     ORDER BY datname`,
  );
  return res.rows.map((r) => String(r[0]));
}

export async function listSchemas(s: PgSession): Promise<string[]> {
  // Two fixes over the DISTINCT join against pg_class:
  //  - has_schema_privilege drops schemas the role cannot enter; they used to
  //    show up in the tree and then expand to an empty list;
  //  - EXISTS lets the planner stop at the first relation instead of building
  //    every (schema, relation) pair only to dedupe them away.
  const res = await s.query(
    `SELECT n.nspname FROM pg_namespace n
     WHERE n.nspname NOT LIKE 'pg\\_%'
       AND n.nspname <> 'information_schema'
       AND has_schema_privilege(n.oid, 'USAGE')
       AND EXISTS (
         SELECT 1 FROM pg_class c
         WHERE c.relnamespace = n.oid AND c.relkind IN ('r','p','v','m','f')
       )
     ORDER BY 1`,
  );
  return res.rows.map((r) => String(r[0]));
}

export async function listRelations(
  s: PgSession,
  schema: string,
): Promise<RelationInfo[]> {
  // reltuples comes along for free here — one query for the whole schema
  // instead of a getTableInfo round-trip per table.
  const res = await s.query(
    `SELECT c.relname, c.relkind::text, c.reltuples::bigint::text FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind IN ('r','p','v','m','f')
     ORDER BY c.relname`,
    [schema],
  );
  return res.rows.map((r) => {
    // -1 means "never analyzed"; views always report -1.
    const est = Number(r[2]);
    return {
      name: String(r[0]),
      kind: r[1] as RelationInfo["kind"],
      rowEstimate: Number.isFinite(est) && est >= 0 ? est : null,
    };
  });
}

export async function listColumns(
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

export async function listPkColumns(
  s: PgSession,
  schema: string,
  table: string,
): Promise<string[]> {
  // indnkeyatts bounds the *key* columns. A covering primary key
  // (PRIMARY KEY (a) INCLUDE (b)) also carries b in indkey, and matching with
  // "attnum = ANY(indkey)" reported b as part of the key — which then fed the
  // WHERE clause of every row update and delete. unnest WITH ORDINALITY keeps
  // the index column order without leaning on array_position over int2vector.
  const res = await s.query(
    `SELECT a.attname
     FROM pg_index i
     CROSS JOIN LATERAL unnest(i.indkey[0:i.indnkeyatts-1])
       WITH ORDINALITY AS k(attnum, ord)
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE i.indrelid = to_regclass($1)
       AND i.indisprimary
       AND NOT a.attisdropped
     ORDER BY k.ord`,
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
  // pg_index carries the flags directly. The old query inferred uniqueness by
  // searching the DDL for "CREATE UNIQUE INDEX" and located the table by name
  // text, which resolved differently from the to_regclass lookup every other
  // catalog query here uses.
  const res = await s.query(
    `SELECT c.relname,
            i.indisunique,
            i.indisprimary,
            pg_get_indexdef(i.indexrelid)
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indexrelid
     WHERE i.indrelid = to_regclass($1) AND i.indislive
     ORDER BY i.indisprimary DESC, c.relname`,
    [regclassParam(schema, table)],
  );
  return res.rows.map((r) => ({
    name: String(r[0]),
    unique: r[1] === true,
    primary: r[2] === true,
    definition: String(r[3]),
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
