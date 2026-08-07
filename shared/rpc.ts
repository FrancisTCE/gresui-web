// Bindings interface — single source of truth for the backend↔frontend RPC
// surface. The backend registration object must `satisfy Bindings`; the
// frontend types the `bindings` global against it.
//
// Bindings encode args as JSON; return only plain data (no Date/Map).
import type {
  BrowseRequest,
  BrowseResponse,
  CellValue,
  ConnectionConfig,
  ConnStatus,
  ExportRequest,
  ExportResponse,
  HistoryEntry,
  IndexInfo,
  McpKeyInfo,
  McpServerInfo,
  McpToolInfo,
  QueryResult,
  RelationInfo,
  Row,
  Settings,
  SettingsPatch,
  TableInfo,
} from "./types.ts";

export interface Bindings {
  getSettings(): Promise<Settings>;
  setSettings(patch: SettingsPatch): Promise<Settings>;
  listConnections(): Promise<ConnectionConfig[]>;
  saveConnection(c: ConnectionConfig): Promise<ConnectionConfig[]>; // upsert by id; returns full list
  deleteConnection(id: string): Promise<ConnectionConfig[]>;
  connect(c: ConnectionConfig): Promise<ConnStatus>; // throws {name, message} on failure
  disconnect(): Promise<void>;
  getStatus(): Promise<ConnStatus>;
  listDatabases(): Promise<string[]>;
  listSchemas(db: string): Promise<string[]>;
  listRelations(schema: string): Promise<RelationInfo[]>;
  getTableInfo(schema: string, table: string): Promise<TableInfo>;
  listIndexes(schema: string, table: string): Promise<IndexInfo[]>;
  getRowCount(schema: string, table: string): Promise<number>; // exact count
  browse(req: BrowseRequest): Promise<BrowseResponse>;
  exportTable(req: ExportRequest): Promise<ExportResponse>;
  insertRow(
    schema: string,
    table: string,
    values: Record<string, CellValue>,
  ): Promise<Row>;
  updateRow(
    schema: string,
    table: string,
    pkColumns: string[],
    pkValues: CellValue[],
    changes: Record<string, CellValue>,
  ): Promise<Row>;
  deleteRows(
    schema: string,
    table: string,
    pkColumns: string[],
    rows: CellValue[][],
  ): Promise<number>; // rows deleted
  runSql(text: string, opts?: { explain?: boolean }): Promise<QueryResult>;
  cancelQuery(): Promise<void>;
  /** Forward a frontend-side error to the backend log file. */
  logError(message: string): Promise<void>;
  listHistory(): Promise<HistoryEntry[]>;
  clearHistory(): Promise<void>;
  getMcpServerInfo(): Promise<McpServerInfo>;
  setMcpEnabled(enabled: boolean): Promise<McpServerInfo>;
  listMcpTools(): Promise<McpToolInfo[]>; // full catalog, for scope checkboxes
  listMcpKeys(): Promise<McpKeyInfo[]>;
  createMcpKey(req: { name: string; scopes: string[]; tables: string[] }): Promise<McpKeyInfo>;
  updateMcpKey(id: string, patch: { name?: string; scopes?: string[]; tables?: string[] }): Promise<McpKeyInfo>;
  deleteMcpKey(id: string): Promise<void>;
}
