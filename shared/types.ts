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

export interface BrowseRequest {
  schema: string;
  table: string;
  where?: string;
  orderBy?: { column: string; dir: "asc" | "desc" };
  limit: number;
  offset: number;
}

export interface BrowseResponse {
  columns: { name: string; type: string }[];
  rows: Row[];
  total: number;
  truncated: boolean;
}

export interface ExportRequest {
  schema: string;
  table: string;
  where?: string;
  orderBy?: { column: string; dir: "asc" | "desc" };
  /** Optional cap; the backend clamps to EXPORT_CAP. */
  maxRows?: number;
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
  createdAt: string;
  lastUsedAt: string | null;
}

/** One recorded MCP tool call. keyName is null when the key was deleted. */
export interface McpUsageEntry {
  ts: string; // ISO
  keyId: string;
  keyName: string | null;
  tool: string;
  ok: boolean;
  durationMs: number;
}

export interface McpServerInfo {
  enabled: boolean;
  port: number | null;
  url: string | null;
}
