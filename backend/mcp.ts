// MCP (Model Context Protocol) server — exposes the app's active PostgreSQL
// session to MCP clients (Claude Desktop, Cursor, …) over loopback HTTP.
//
// Clients authenticate with per-key bearer API keys (see config.ts); each key
// is scoped to a subset of the tools below and may carry a "schema.table"
// or "db.schema.table" allowlist (unqualified entries mean the anchor
// database). Tools are read-only. Every table-taking tool accepts an optional
// `db` argument naming a bundled database (default = anchor); with no
// database connected they error "Not connected".
//
// `where` filters are raw user SQL spliced verbatim — intentional editor
// semantics (Compass parity), same trust level as the FilterBar / SQL tab.
// MCP keys are read-only by construction (there is no run_sql tool); the
// table allowlist restricts the table-taking tools and filters list_tables.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

// Node requires the import attribute for JSON; Bun accepted a bare specifier.
import pkg from "../package.json" with { type: "json" };
import type {
  BrowseRequest,
  ConnStatus,
  McpKeyInfo,
  McpLens,
  McpServerInfo,
} from "../shared/types.ts";
import { rowKey } from "../shared/row-key.ts";
import * as config from "./config.ts";
import * as data from "./data.ts";
import * as events from "./events.ts";
import { serve, type Listener } from "./http.ts";
import * as meta from "./meta.ts";
import type { PgSession } from "./pg.ts";

export interface Ctx {
  /** db undefined = the anchor database. Throws "Not connected" / "database not in this connection: …". */
  getSession(db?: string): Promise<PgSession>;
  getDatabases(): string[]; // anchor + bundle, configured on the active connection
  getStatus(): ConnStatus; // never throws
}

/** What a call did, for the activity feed. Tools fill in whatever applies;
 * the request handler reads it once the call has settled.
 *
 * Passed in rather than derived from the result because only the tool knows
 * which relation it resolved, which lens it applied, and which of the
 * returned columns are the primary key. */
export interface Trace {
  /** Canonical "db.schema.table" this call resolved to. */
  target: string | null;
  /** Rows handed over, or counted. */
  rowCount: number | null;
  /** rowKey() per row handed over — null when the rows cannot be identified
   * (no primary key, or the lens hides part of it). */
  rowKeys: string[] | null;
  /** The lens that was in force, if any. */
  lens: McpLens | null;
}

export function newTrace(): Trace {
  return { target: null, rowCount: null, rowKeys: null, lens: null };
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  run(
    args: Record<string, unknown>,
    ctx: Ctx,
    key: McpKeyInfo,
    trace: Trace,
  ): Promise<unknown>;
}

// --- tool catalog -----------------------------------------------------------

export const MCP_TOOLS: McpTool[] = [
  {
    name: "list_schemas",
    description: "List all non-system schemas in the connected database (default: anchor).",
    inputSchema: { db: z.string().optional() },
    run: async (args, ctx, _key) => {
      const db = args.db !== undefined ? String(args.db) : undefined;
      const sess = await ctx.getSession(db);
      return meta.listSchemas(sess);
    },
  },
  {
    name: "list_tables",
    description:
      "List tables/views in a schema. When the API key has a table allowlist, only allowlisted schema.table relations are returned.",
    inputSchema: { db: z.string().optional(), schema: z.string() },
    run: async (args, ctx, key) => {
      const db = args.db !== undefined ? String(args.db) : undefined;
      const schema = String(args.schema);
      const sess = await ctx.getSession(db);
      const rels = await meta.listRelations(sess, schema);
      return rels.filter((r) =>
        allows(key, ctx, db, schema, r.name)
      );
    },
  },
  {
    name: "list_databases",
    description: "List the databases reachable through this connection (anchor first, then bundled).",
    inputSchema: {},
    run: (_args, ctx, _key) => Promise.resolve(ctx.getDatabases()),
  },
  {
    name: "get_table",
    description: "Describe a table: columns, primary key columns, row estimate.",
    inputSchema: { db: z.string().optional(), schema: z.string(), table: z.string() },
    run: async (args, ctx, key, trace) => {
      const { db, schema, table, lens } = resolve(args, ctx, key, trace);
      const sess = await ctx.getSession(db);
      const info = await meta.getTableInfo(sess, schema, table);
      if (!lens) return info;
      // A hidden column must not show up in the schema either — the agent
      // should not know it exists, let alone try to select it.
      const hidden = new Set(lens.hiddenColumns);
      return {
        ...info,
        columns: info.columns.filter((c) => !hidden.has(c.name)),
        pkColumns: info.pkColumns.filter((c) => !hidden.has(c)),
      };
    },
  },
  {
    name: "get_rows",
    description:
      "Fetch rows from a table. `where` is raw SQL (same trust level as the filter bar in gresui) — e.g. \"id > 100\". Result rows are arrays aligned with `columns`; `total` counts matching rows, but is a planner estimate when `estimated` is true (large relations — call row_count for an exact figure); `truncated` is true when more rows match than this page returns (use `offset` to page further).",
    inputSchema: {
      db: z.string().optional(),
      schema: z.string(),
      table: z.string(),
      where: z.string().optional(),
      orderBy: z.object({
        column: z.string(),
        dir: z.enum(["asc", "desc"]),
      }).optional(),
      limit: z.number().int().min(1).max(1000).default(50),
      offset: z.number().int().min(0).default(0),
    },
    run: async (args, ctx, key, trace) => {
      const { db, schema, table, lens } = resolve(args, ctx, key, trace);
      const sess = await ctx.getSession(db);
      const offset = Number(args.offset ?? 0);
      const res = await data.browse(sess, {
        schema,
        table,
        where: typeof args.where === "string" ? args.where : undefined,
        orderBy: args.orderBy as { column: string; dir: "asc" | "desc" } | undefined,
        limit: Number(args.limit ?? 50),
        offset,
        lens: await browseLens(sess, schema, table, lens),
      });
      // Stamp the rows so the app can show the operator exactly which records
      // went out. A relation with no primary key — or one whose key the lens
      // hides — simply cannot be identified, and says so by leaving this null.
      const pks = await meta.listPkColumns(sess, schema, table);
      const idx = pks.map((pk) => res.columns.findIndex((c) => c.name === pk));
      trace.rowCount = res.rows.length;
      trace.rowKeys = pks.length > 0 && idx.every((i) => i >= 0)
        ? res.rows.map((r) => rowKey(idx.map((i) => r[i] ?? null)))
        : null;
      return {
        ...res,
        truncated: offset + res.rows.length < res.total,
      };
    },
  },
  {
    name: "row_count",
    description:
      "Exact count of rows in a table (optionally filtered by `where`, raw SQL).",
    inputSchema: {
      db: z.string().optional(),
      schema: z.string(),
      table: z.string(),
      where: z.string().optional(),
    },
    run: async (args, ctx, key, trace) => {
      const { db, schema, table, lens } = resolve(args, ctx, key, trace);
      const sess = await ctx.getSession(db);
      const res = await data.browse(sess, {
        schema,
        table,
        where: typeof args.where === "string" ? args.where : undefined,
        limit: 1,
        offset: 0,
        countMode: "exact",
        lens: await browseLens(sess, schema, table, lens),
      });
      trace.rowCount = res.total;
      return { count: res.total };
    },
  },
  {
    name: "list_indexes",
    description: "List indexes on a table with their definitions.",
    inputSchema: { db: z.string().optional(), schema: z.string(), table: z.string() },
    run: async (args, ctx, key, trace) => {
      const { db, schema, table, lens } = resolve(args, ctx, key, trace);
      const sess = await ctx.getSession(db);
      const indexes = await meta.listIndexes(sess, schema, table);
      if (!lens || lens.hiddenColumns.length === 0) return indexes;
      // An index definition spells out its columns, so returning one that
      // covers a hidden column would name the column the lens just withheld.
      return indexes.filter((i) =>
        !lens.hiddenColumns.some((c) => definitionMentions(i.definition, c))
      );
    },
  },
  {
    name: "get_status",
    description:
      "Connection status of the gresui backend: { connected, host?, port?, database?, user? }. Never throws.",
    inputSchema: {},
    run: (_args, ctx, _key) => Promise.resolve(ctx.getStatus()),
  },
];

// Static catalog membership — a fixed lookup table.
const MCP_TOOL_NAMES: Record<string, true> = Object.fromEntries(
  MCP_TOOLS.map((t) => [t.name, true]),
);

// --- validation (called by the bindings before config writes) ----------------

const TABLE_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

/** Validate only the fields that are defined; throws Error with a specific
 * message. Scopes must be non-empty and known; tables entries must match
 * "db.schema.table" or "schema.table" identifier syntax. */
export function validateMcpKeyInput(patch: {
  name?: string;
  scopes?: string[];
  tables?: string[];
}): void {
  if (patch.name !== undefined && patch.name.trim() === "") {
    throw new Error("API key name must not be empty");
  }
  if (patch.scopes !== undefined) {
    if (patch.scopes.length === 0) {
      throw new Error("select at least one tool scope");
    }
    for (const s of patch.scopes) {
      if (!MCP_TOOL_NAMES[s]) {
        throw new Error(`unknown tool scope: ${s}`);
      }
    }
  }
  if (patch.tables !== undefined) {
    for (const t of patch.tables) {
      if (!TABLE_RE.test(t)) {
        throw new Error(
          `invalid table restriction: ${t} (expected db.schema.table or schema.table)`,
        );
      }
    }
  }
}

/** Structural check on a lens before it is stored. The row filter is raw SQL
 * spliced into the lens subquery, exactly like the filter bar — but unlike
 * the filter bar it is written once by the operator and then applied to every
 * request the key makes, so a stray statement terminator would be a much
 * longer-lived mistake than a mistyped filter. Semantics (does the column
 * exist? does the filter parse?) are the database's to judge, on first use. */
export function validateMcpLens(lens: {
  table?: unknown;
  hiddenColumns?: unknown;
  rowFilter?: unknown;
}): void {
  if (typeof lens.table !== "string" || !TABLE_RE.test(lens.table)) {
    throw new Error(
      `invalid lens table: ${String(lens.table)} (expected db.schema.table or schema.table)`,
    );
  }
  if (!Array.isArray(lens.hiddenColumns)) {
    throw new Error("lens hiddenColumns must be an array");
  }
  for (const c of lens.hiddenColumns) {
    if (typeof c !== "string" || c.trim() === "") {
      throw new Error("lens hidden column names must be non-empty strings");
    }
  }
  if (typeof lens.rowFilter !== "string") {
    throw new Error("lens rowFilter must be a string");
  }
  if (lens.rowFilter.length > 4000) {
    throw new Error("lens row filter is too long (4000 characters max)");
  }
  if (lens.rowFilter.includes(";")) {
    throw new Error("lens row filter must be a single boolean expression (no \";\")");
  }
}

/** Whether an index definition covers `column`.
 *
 * `pg_get_indexdef` only quotes an identifier that needs it, so a lowercase
 * column appears bare — `USING btree (ssn)`, not `("ssn")`. Both forms have
 * to be recognized, and the bare one on identifier boundaries: a hidden
 * `name` must not be "found" inside `full_name`, and must not be missed
 * inside `(name)`. */
export function definitionMentions(definition: string, column: string): boolean {
  if (definition.includes('"' + column.replaceAll('"', '""') + '"')) return true;
  const escaped = column.replaceAll(/[$()*+.?[\\\]^{|}]/g, (m) => "\\" + m);
  return new RegExp(`(^|[^A-Za-z0-9_$])${escaped}([^A-Za-z0-9_$]|$)`)
    .test(definition);
}

// --- table gate ---------------------------------------------------------------

/** Allowlist key: unqualified entries mean the anchor database. */
function qualify(db: string | undefined, schema: string, table: string): string {
  return db ? `${db}.${schema}.${table}` : `${schema}.${table}`;
}

/** "db.schema.table" — the single form both sides are compared in. An entry
 * written "public.users" and a call that passes db: "<anchor>" name the same
 * relation, so neither side may be matched as it happens to be spelled. */
function canonical(ref: string, anchorDb: string): string {
  return ref.split(".").length === 2 ? `${anchorDb}.${ref}` : ref;
}

function allows(
  key: McpKeyInfo,
  ctx: Ctx,
  db: string | undefined,
  schema: string,
  table: string,
): boolean {
  if (key.tables.length === 0) return true; // no allowlist = every table
  const anchorDb = ctx.getDatabases()[0] ?? "";
  const want = canonical(qualify(db, schema, table), anchorDb);
  return key.tables.some((t) => canonical(t, anchorDb) === want);
}

function checkTable(
  key: McpKeyInfo,
  ctx: Ctx,
  db: string | undefined,
  schema: string,
  table: string,
): void {
  if (!allows(key, ctx, db, schema, table)) {
    throw new Error(
      `table not allowed for this API key: ${qualify(db, schema, table)}`,
    );
  }
}

/** The lens this key carries for this relation, or null for the whole table. */
function lensFor(
  key: McpKeyInfo,
  ctx: Ctx,
  db: string | undefined,
  schema: string,
  table: string,
): McpLens | null {
  if (key.lenses.length === 0) return null;
  const anchorDb = ctx.getDatabases()[0] ?? "";
  const want = canonical(qualify(db, schema, table), anchorDb);
  return key.lenses.find((l) => canonical(l.table, anchorDb) === want) ?? null;
}

/** Resolve the relation a table-taking tool was pointed at: enforce the
 * allowlist, pick up the lens, and record both on the trace. Every
 * table-taking tool starts here, so there is one place where "may this key
 * touch this relation, and in what shape" is decided. */
function resolve(
  args: Record<string, unknown>,
  ctx: Ctx,
  key: McpKeyInfo,
  trace: Trace,
): { db: string | undefined; schema: string; table: string; lens: McpLens | null } {
  const db = args.db !== undefined ? String(args.db) : undefined;
  const schema = String(args.schema);
  const table = String(args.table);
  checkTable(key, ctx, db, schema, table);
  const anchorDb = ctx.getDatabases()[0] ?? "";
  trace.target = canonical(qualify(db, schema, table), anchorDb);
  const lens = lensFor(key, ctx, db, schema, table);
  trace.lens = lens;
  return { db, schema, table, lens };
}

/** Columns of `table` this lens leaves visible, in catalog order. */
async function visibleColumns(
  sess: PgSession,
  schema: string,
  table: string,
  lens: McpLens,
): Promise<string[]> {
  const cols = await meta.listColumns(sess, schema, table);
  const hidden = new Set(lens.hiddenColumns);
  const visible = cols.map((c) => c.name).filter((n) => !hidden.has(n));
  if (visible.length === 0) {
    throw new Error(
      `lens for this API key hides every column of ${schema}.${table}`,
    );
  }
  return visible;
}

/** The browse projection for a lens, or undefined for unrestricted access. */
async function browseLens(
  sess: PgSession,
  schema: string,
  table: string,
  lens: McpLens | null,
): Promise<BrowseRequest["lens"]> {
  if (!lens) return undefined;
  return {
    columns: await visibleColumns(sess, schema, table, lens),
    filter: lens.rowFilter || undefined,
  };
}

// --- listener ------------------------------------------------------------------

export const MCP_PORT_PREFERRED = 3939;

let listener: Listener | null = null;

export async function start(ctx: Ctx): Promise<number> {
  if (listener) return listener.port;
  const bind = (port: number): Promise<Listener> =>
    serve({
      hostname: "127.0.0.1",
      port,
      fetch: (req: Request): Promise<Response> => handleMcp(req, ctx),
    });
  try {
    listener = await bind(MCP_PORT_PREFERRED);
  } catch {
    // preferred port taken — fall back to a random port
    listener = await bind(0);
  }
  return listener.port;
}

export async function stop(): Promise<void> {
  const l = listener;
  listener = null;
  await l?.stop();
}

export function isRunning(): boolean {
  return listener !== null;
}

export function getInfo(): McpServerInfo {
  const port = listener?.port ?? null;
  return {
    enabled: listener !== null,
    port,
    url: port ? `http://127.0.0.1:${port}/mcp` : null,
  };
}

// --- auth + dispatch -------------------------------------------------------------

function mcpError(status: number, code: number, message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code, message },
    }),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
}

export async function handleMcp(req: Request, ctx: Ctx): Promise<Response> {
  if (!listener) return new Response("MCP disabled", { status: 403 });
  if (new URL(req.url).pathname !== "/mcp") {
    return new Response("Not found", { status: 404 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const raw = auth.startsWith("Bearer ")
    ? auth.slice("Bearer ".length).trim()
    : "";
  const keyInfo = raw ? await config.findMcpKeyByValue(raw) : null;
  if (!keyInfo) {
    // NEVER log the key value
    console.warn("mcp: unauthorized request");
    return mcpError(401, -32001, "unauthorized");
  }
  void config.touchMcpKey(keyInfo.id).catch(() => {});

  // Per-request, stateless server (official example pattern): register only
  // the key's scoped tools, so tools/list shows exactly what the key may call.
  const server = new McpServer({ name: "gresui", version: pkg.version });
  for (const tool of MCP_TOOLS) {
    if (!keyInfo.scopes.includes(tool.name)) continue;
    server.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args) => {
        const t0 = performance.now();
        const trace = newTrace();
        const audit = (ok: boolean, error: string | null): void => {
          // Recording must never delay or fail the agent's reply: the await
          // is deliberately not on the response path, and the publish is
          // chained off the write so the feed shows the row that was stored.
          void config.recordMcpUsage({
            keyId: keyInfo.id,
            tool: tool.name,
            ok,
            durationMs: Math.round(performance.now() - t0),
            target: trace.target,
            args: args as Record<string, unknown>,
            rowCount: trace.rowCount,
            rowKeys: trace.rowKeys,
            lens: trace.lens,
            error,
          })
            .then((entry) => events.publish({ type: "mcp-activity", entry }))
            .catch(() => {});
        };
        try {
          const text = JSON.stringify(
            await tool.run(args as Record<string, unknown>, ctx, keyInfo, trace),
          );
          audit(true, null);
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          audit(false, (e as Error).message);
          throw e;
        }
      },
    );
  }

  // No sessionIdGenerator: its absence *is* the SDK's stateless mode, and a
  // fresh server per request is what makes this listener safe to hand a
  // per-key scope on every call.
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return await transport.handleRequest(req);
}
