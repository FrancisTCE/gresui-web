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
