// Postgres driver wrapper — the ONLY file touching the driver (postgres).
// Swap point for npm:pg: keep this PgSession surface identical.

import postgres from "postgres";
import type { CellValue, ConnectionConfig, Row } from "../../shared/types.ts";

export interface QueryOutcome {
  columns: { name: string; type: string }[];
  rows: Row[];
  rowCount: number;
  command: string;
}

export function quoteIdent(parts: string[]): string {
  if (parts.length === 0) throw new Error("quoteIdent: empty parts");
  return parts.map((p) => `"${p.replaceAll('"', '""')}"`).join(".");
}

/** Normalize driver values into CellValue (JSON-safe plain data). */
function normalizeCell(v: unknown): CellValue {
  if (
    v === null || typeof v === "boolean" || typeof v === "number" ||
    typeof v === "string"
  ) {
    return v;
  }
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) {
    // bytea — hex, Postgres-native representation
    let hex = "";
    for (const b of v) hex += b.toString(16).padStart(2, "0");
    return `\\x${hex}`;
  }
  if (typeof v === "object") return JSON.stringify(v); // json/jsonb parsed objects
  return String(v);
}

function pgMessage(e: unknown): string {
  return String((e as { message?: unknown })?.message ?? e);
}

interface RawColumn {
  name: string;
  type: number; // type OID
}

export class PgSession {
  private cfg: ConnectionConfig;
  private sql: ReturnType<typeof postgres> | null = null;
  private typeMap = new Map<number, string>();
  private current: { cancel(): unknown } | null = null;

  constructor(cfg: ConnectionConfig) {
    this.cfg = cfg;
  }

  get host(): string {
    return this.cfg.host;
  }

  get port(): number {
    return this.cfg.port;
  }

  get user(): string {
    return this.cfg.user;
  }

  get database(): string {
    return this.cfg.database || "postgres";
  }

  async connect(): Promise<void> {
    const { cfg } = this;
    const ssl = cfg.ssl === "disable"
      ? false
      : cfg.ssl === "require"
      ? { rejectUnauthorized: false }
      : { rejectUnauthorized: true };
    const sql = postgres({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database || "postgres",
      max: 1,
      idle_timeout: 0,
      connection: { application_name: "gresui" },
      ssl,
    });
    try {
      // Probe — the driver is lazy; this makes connection failures synchronous.
      await sql`SELECT 1`;
    } catch (err) {
      await sql.end().catch(() => {});
      throw new Error(pgMessage(err));
    }
    this.sql = sql;
    await this.loadTypeMap();
  }

  private async loadTypeMap(): Promise<void> {
    const res = await this.sql!.unsafe<
      { oid: number; typname: string }[]
    >("SELECT oid::int4 AS oid, typname FROM pg_type", []);
    this.typeMap = new Map(res.map((r) => [r.oid, r.typname]));
  }

  private typeName(oid: number): string {
    const t = this.typeMap.get(oid);
    if (t === undefined) return `oid:${oid}`;
    // array types are named `_int4` etc.
    return t.startsWith("_") ? `${t.slice(1)}[]` : t;
  }

  private isMultiResult(result: unknown): boolean {
    // postgres.js: single-statement resolves with a Result (an Array subclass
    // whose rows are plain objects); multi-statement resolves with a plain
    // array of Results. A multi result's first element is itself a Result
    // (has a `columns` own-property); a single result's first element is a row.
    return Array.isArray(result) && result.length > 0 &&
      typeof result[0] === "object" && result[0] !== null &&
      "columns" in result[0];
  }

  private toOutcome(r: unknown): QueryOutcome {
    const rawCols: RawColumn[] = (r as { columns?: RawColumn[] })?.columns ?? [];
    const columns = rawCols.map((c) => ({
      name: c.name,
      type: this.typeName(c.type),
    }));
    const rows: Row[] = ((r as unknown[]) ?? []).map((row) =>
      rawCols.map((c) => normalizeCell((row as Record<string, unknown>)[c.name])),
    );
    return {
      columns,
      rows,
      rowCount: (r as { count?: number })?.count ?? 0,
      command: (r as { command?: string })?.command ?? "",
    };
  }

  private async run(
    text: string,
    params: unknown[],
    all: boolean,
  ): Promise<QueryOutcome[] | QueryOutcome> {
    if (!this.sql) throw new Error("Not connected");
    const q = this.sql.unsafe(
      text,
      params as Parameters<typeof this.sql.unsafe>[1],
    );
    this.current = q;
    try {
      const result = await q;
      if (!this.isMultiResult(result)) return this.toOutcome(result);
      const outcomes = (result as unknown[]).map((r) => this.toOutcome(r));
      return all ? outcomes : outcomes[0];
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "57014" || code === "57015") {
        throw new Error("Query cancelled");
      }
      throw err;
    } finally {
      if (this.current === q) this.current = null;
    }
  }

  async query(text: string, params: unknown[] = []): Promise<QueryOutcome> {
    return await this.run(text, params, false) as QueryOutcome;
  }

  /** Every result set of a multi-statement string (transaction wraps etc.). */
  async queryAll(text: string, params: unknown[] = []): Promise<QueryOutcome[]> {
    return await this.run(text, params, true) as QueryOutcome[];
  }

  /** Sends a PostgreSQL CancelRequest for the in-flight query. */
  async cancel(): Promise<void> {
    this.current?.cancel();
  }

  async close(): Promise<void> {
    const sql = this.sql;
    this.sql = null;
    if (sql) await sql.end().catch(() => {});
  }
}
