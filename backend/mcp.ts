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

import pkg from "../package.json";
import type { ConnStatus, McpKeyInfo, McpServerInfo } from "../shared/types.ts";
import * as config from "./config.ts";
import * as data from "./data.ts";
import * as meta from "./meta.ts";
import type { PgSession } from "./pg.ts";

export interface Ctx {
  /** db undefined = the anchor database. Throws "Not connected" / "database not in this connection: …". */
  getSession(db?: string): Promise<PgSession>;
  getDatabases(): string[]; // anchor + bundle, configured on the active connection
  getStatus(): ConnStatus; // never throws
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  run(args: Record<string, unknown>, ctx: Ctx, key: McpKeyInfo): Promise<unknown>;
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
        !key.tables.length || key.tables.includes(qualify(db, schema, r.name))
      );
    },
  },
  {
    name: "list_databases",
    description: "List the databases reachable through this connection (anchor first, then bundled).",
    inputSchema: {},
    run: async (_args, ctx, _key) => ctx.getDatabases(),
  },
  {
    name: "get_table",
    description: "Describe a table: columns, primary key columns, row estimate.",
    inputSchema: { db: z.string().optional(), schema: z.string(), table: z.string() },
    run: async (args, ctx, key) => {
      const db = args.db !== undefined ? String(args.db) : undefined;
      const sess = await ctx.getSession(db);
      checkTable(key, db, String(args.schema), String(args.table));
      return await meta.getTableInfo(
        sess,
        String(args.schema),
        String(args.table),
      );
    },
  },
  {
    name: "get_rows",
    description:
      "Fetch rows from a table. `where` is raw SQL (same trust level as the filter bar in gresui) — e.g. \"id > 100\". Result rows are arrays aligned with `columns`; `total` counts matching rows; `truncated` is true when more rows match than this page returns (use `offset` to page further).",
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
    run: async (args, ctx, key) => {
      const db = args.db !== undefined ? String(args.db) : undefined;
      const sess = await ctx.getSession(db);
      checkTable(key, db, String(args.schema), String(args.table));
      const offset = Number(args.offset ?? 0);
      const res = await data.browse(sess, {
        schema: String(args.schema),
        table: String(args.table),
        where: typeof args.where === "string" ? args.where : undefined,
        orderBy: args.orderBy as { column: string; dir: "asc" | "desc" } | undefined,
        limit: Number(args.limit ?? 50),
        offset,
      });
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
    run: async (args, ctx, key) => {
      const db = args.db !== undefined ? String(args.db) : undefined;
      const sess = await ctx.getSession(db);
      checkTable(key, db, String(args.schema), String(args.table));
      const res = await data.browse(sess, {
        schema: String(args.schema),
        table: String(args.table),
        where: typeof args.where === "string" ? args.where : undefined,
        limit: 1,
        offset: 0,
      });
      return { count: res.total };
    },
  },
  {
    name: "list_indexes",
    description: "List indexes on a table with their definitions.",
    inputSchema: { db: z.string().optional(), schema: z.string(), table: z.string() },
    run: async (args, ctx, key) => {
      const db = args.db !== undefined ? String(args.db) : undefined;
      const sess = await ctx.getSession(db);
      checkTable(key, db, String(args.schema), String(args.table));
      return await meta.listIndexes(
        sess,
        String(args.schema),
        String(args.table),
      );
    },
  },
  {
    name: "get_status",
    description:
      "Connection status of the gresui backend: { connected, host?, port?, database?, user? }. Never throws.",
    inputSchema: {},
    run: async (_args, ctx, _key) => ctx.getStatus(),
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

// --- table gate ---------------------------------------------------------------

/** Allowlist key: unqualified entries mean the anchor database. */
function qualify(db: string | undefined, schema: string, table: string): string {
  return db ? `${db}.${schema}.${table}` : `${schema}.${table}`;
}

function checkTable(key: McpKeyInfo, db: string | undefined, schema: string, table: string): void {
  const q = qualify(db, schema, table);
  if (key.tables.length > 0 && !key.tables.includes(q)) {
    throw new Error(`table not allowed for this API key: ${q}`);
  }
}

// --- listener ------------------------------------------------------------------

export const MCP_PORT_PREFERRED = 3939;

export interface McpListener {
  port: number;
  stop(): void;
}

let listener: McpListener | null = null;

export function start(ctx: Ctx): number {
  if (listener) return listener.port;
  const serve = (port: number): McpListener =>
    Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: (req: Request): Promise<Response> => handleMcp(req, ctx),
    });
  try {
    listener = serve(MCP_PORT_PREFERRED);
  } catch {
    // preferred port taken — fall back to a random port
    listener = serve(0);
  }
  return listener.port;
}

export function stop(): void {
  listener?.stop();
  listener = null;
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
        try {
          const text = JSON.stringify(
            await tool.run(args as Record<string, unknown>, ctx, keyInfo),
          );
          void config.recordMcpUsage({
            keyId: keyInfo.id,
            tool: tool.name,
            ok: true,
            durationMs: Math.round(performance.now() - t0),
          }).catch(() => {});
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          void config.recordMcpUsage({
            keyId: keyInfo.id,
            tool: tool.name,
            ok: false,
            durationMs: Math.round(performance.now() - t0),
          }).catch(() => {});
          throw e;
        }
      },
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return await transport.handleRequest(req);
}
