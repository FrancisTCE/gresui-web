// Shared types — pure types, no runtime imports. Both realms (backend,
// web frontend) import this file directly.

export interface ConnectionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: "disable" | "require" | "verify";
  /** Additional databases on the same server to bundle into this connection
   * (besides the anchor `database`); the sidebar shows them as siblings.
   * Absent/empty = single-database behavior. */
  databases?: string[];
  lastUsed?: string;
}

export interface ConnStatus {
  connected: boolean;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  error?: string;
}

export type RelationKind = "r" | "p" | "v" | "m" | "f";

export interface RelationInfo {
  name: string;
  kind: RelationKind;
  /** Planner row estimate (pg_class.reltuples); null when never analyzed. */
  rowEstimate: number | null;
}

export interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  hasDefault: boolean;
  isPk: boolean;
  ordinal: number;
}

export interface IndexInfo {
  name: string;
  unique: boolean;
  /** Backs the table's PRIMARY KEY constraint. */
  primary: boolean;
  definition: string;
}

export interface TableInfo {
  schema: string;
  table: string;
  columns: ColumnInfo[];
  pkColumns: string[];
  rowEstimate: number | null;
}

// bigint/timestamptz arrive as strings from the driver — normalized on the backend.
export type CellValue = null | boolean | number | string;
export type Row = CellValue[];

/** How `browse` decides the total row count.
 * "auto"  — planner estimate first; an exact count only when it is cheap.
 * "exact" — always count(*), however slow (the user asked for it). */
export type CountMode = "auto" | "exact";

export interface BrowseRequest {
  schema: string;
  table: string;
  where?: string | undefined;
  orderBy?: { column: string; dir: "asc" | "desc" } | undefined;
  limit: number;
  offset: number;
  /** Defaults to "auto". */
  countMode?: CountMode | undefined;
  /** Read the table through a projection instead of directly: only these
   * columns exist, and `filter` is already applied, before `where` above is
   * evaluated. Set for MCP keys that carry a lens; never set for the app's
   * own grid, which is the operator's own full-access view. */
  lens?: { columns: string[]; filter?: string | undefined } | undefined;
}

export interface BrowseResponse {
  columns: { name: string; type: string }[];
  rows: Row[];
  total: number;
  /** True when `total` is a planner estimate, not an exact count. */
  estimated: boolean;
}

export interface ExportRequest {
  schema: string;
  table: string;
  where?: string | undefined;
  orderBy?: { column: string; dir: "asc" | "desc" } | undefined;
  /** Optional cap; the backend clamps to EXPORT_CAP. */
  maxRows?: number | undefined;
}

export interface ExportResponse {
  columns: { name: string; type: string }[];
  rows: Row[];
  truncated: boolean;
}

export interface QueryResult {
  columns: { name: string; type: string }[];
  rows: Row[];
  rowCount: number;
  durationMs: number;
  command: string;
}

export interface HistoryEntry {
  text: string;
  ts: string;
  durationMs: number;
}

export interface Settings {
  theme: "dark" | "light";
  window: { width: number; height: number; x?: number; y?: number };
}

/** Patch shape for setSettings: nested window fields stay optional. */
export type SettingsPatch = Partial<Omit<Settings, "window">> & {
  window?: Partial<Settings["window"]>;
};

export interface McpToolInfo {
  name: string;
  description: string;
}

/** A lens: the shape of one table as one API key is allowed to see it.
 *
 * Enforced by projecting the table through a subquery before the agent's own
 * `where` is applied, so hidden columns are not merely stripped from the
 * reply — they are not in scope for anything the agent can write. */
export interface McpLens {
  /** "schema.table" or "db.schema.table" — same form as the key allowlist. */
  table: string;
  /** Columns withheld from this key; [] = the whole row. */
  hiddenColumns: string[];
  /** Raw SQL AND-ed into every read of this table; "" = no filter. */
  rowFilter: string;
}

/** Key value is decrypted in-process (frontend is the app's own trust boundary,
 * same as connection passwords); stored encrypted at rest. */
export interface McpKeyInfo {
  id: string;
  name: string;
  key: string;
  /** Tool names this key may call; always non-empty. */
  scopes: string[];
  /** "schema.table" allowlist; [] = all tables. */
  tables: string[];
  /** Per-table column/row restrictions; absent entries = the whole table. */
  lenses: McpLens[];
  createdAt: string;
  lastUsedAt: string | null;
}

/** One recorded MCP tool call — the history row and the live event are the
 * same record, so the feed and the table cannot disagree. keyName is null
 * when the key was deleted. */
export interface McpUsageEntry {
  /** Monotonic; the frontend dedupes replay against live by this. */
  id: number;
  ts: string; // ISO
  keyId: string;
  keyName: string | null;
  tool: string;
  ok: boolean;
  durationMs: number;
  /** "db.schema.table" the call addressed, when it took a relation. */
  target: string | null;
  /** The arguments the agent sent. MCP args carry no credentials. */
  args: Record<string, unknown> | null;
  /** Rows handed over (get_rows) or counted (row_count). */
  rowCount: number | null;
  /** rowKey() of each row handed over — what the grid flashes. */
  rowKeys: string[] | null;
  /** The lens in force for this call, when one applied. */
  lens: McpLens | null;
  /** Failure message, when ok is false. */
  error: string | null;
}

/** Pushed to the frontend over `GET /events` as it happens. Every event
 * carries its own tag, so one stream can grow more kinds without the client
 * having to guess from shape. */
export type AppEvent = { type: "mcp-activity"; entry: McpUsageEntry };

export interface McpServerInfo {
  enabled: boolean;
  port: number | null;
  url: string | null;
}
