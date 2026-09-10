// gresui-web entrypoint — a loopback HTTP server that serves the prebuilt
// frontend (dist/) and a JSON-RPC endpoint (/rpc) to the PostgreSQL backend.
// The browser is opened on launch.

import { spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import path, { normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ignoreError } from "../shared/noop.ts";
import type { Bindings } from "../shared/rpc.ts";
import type {
  CellValue,
  ConnectionConfig,
  ConnStatus,
  McpKeyInfo,
  Settings,
} from "../shared/types.ts";
import * as config from "./config.ts";
import * as data from "./data.ts";
import * as events from "./events.ts";
import { serve } from "./http.ts";
import * as mcp from "./mcp.ts";
import * as meta from "./meta.ts";
import { PgPool, PgSession } from "./pg.ts";
import * as sql from "./sql.ts";

// --- paths ------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

// --- logging ----------------------------------------------------------------

// Tee console output to gresui.log (cwd, falling back to the config dir).
let logPath: string | null = null;

const logStamp = (): string => new Date().toISOString();

function setupLogging(): void {
  const candidates = [
    `${process.cwd()}/gresui.log`,
    `${config.configDir()}/gresui.log`,
  ];
  for (const p of candidates) {
    try {
      openSync(p, "a");
      try {
        chmodSync(p, 0o600);
      } catch {
        // best-effort (no-op on Windows)
      }
      logPath = p;
      break;
    } catch {
      // try next candidate
    }
  }
  if (!logPath) return;
  // Pinned: `logPath` is module-level and mutable, so the closure below has
  // to hold the value the guard just proved non-null.
  const dest = logPath;
  const write = (level: string, args: unknown[]): void => {
    const line = `[${logStamp()}] ${level} ${args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")}\n`;
    try {
      const fd = openSync(dest, "a");
      try {
        writeSync(fd, line);
      } finally {
        closeSync(fd);
      }
    } catch {
      // logging is best-effort
    }
  };
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = (...a) => {
    write("LOG", a);
    orig.log(...a);
  };
  console.error = (...a) => {
    write("ERR", a);
    orig.error(...a);
  };
  console.warn = (...a) => {
    write("WARN", a);
    orig.warn(...a);
  };
  console.log("gresui backend logging initialized");
}

// --- static serving ---------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

const FALLBACK_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>GRESUI</title></head>
<body style="background:#1d2129;color:#dde1e6;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1 style="margin:0 0 8px;color:#13aa52;letter-spacing:.08em">GRESUI</h1>
<p style="margin:0">The frontend build is missing. Reinstall gresui-web.</p></div></body></html>`;

function serveStatic(req: Request): Response {
  const url = new URL(req.url);
  let p: string;
  try {
    p = decodeURIComponent(url.pathname);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  if (p === "/") p = "/index.html";

  const filePath = normalize(`${DIST}/${p.replace(/^\/+/, "")}`);
  if (!filePath.startsWith(`${DIST}${path.sep}`)) {
    return new Response("Forbidden", { status: 403 });
  }

  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const HARDENED = { "x-content-type-options": "nosniff" };
  try {
    if (p === "/index.html") {
      // Only the app shell needs the RPC token; hashed assets never do.
      // Replace first </head> (present in the Vite build); if absent, serve
      // the file unchanged.
      const text = readFileSync(filePath, "utf8").replace(
        "</head>",
        `<script>window.__GRESUI_TOKEN__=${JSON.stringify(RPC_TOKEN)}</script></head>`,
      );
      return new Response(text, {
        headers: { "content-type": "text/html", ...HARDENED },
      });
    }
    const body = readFileSync(filePath);
    return new Response(body, {
      headers: {
        "content-type": MIME[ext] ?? "application/octet-stream",
        ...HARDENED,
      },
    });
  } catch {
    if (!p.split("/").pop()?.includes(".")) {
      return new Response(FALLBACK_HTML, {
        headers: { "content-type": "text/html", ...HARDENED },
      });
    }
    return new Response("Not found", { status: 404, headers: HARDENED });
  }
}

// Per-launch token injected into the served index.html; the SPA sends it
// back on every /rpc call. It is a CSRF/cross-origin defense (same-UID
// processes can read it from the page — accepted), not user authentication.
const RPC_TOKEN = crypto.randomUUID();

function handleRequest(req: Request): Response | Promise<Response> {
  const u = new URL(req.url);
  if (req.method === "POST" && u.pathname === "/rpc") return handleRpc(req);
  if (req.method === "GET" && u.pathname === "/events")
    return handleEvents(req);
  return serveStatic(req);
}

/** Server-sent events: MCP tool calls as they happen.
 *
 * Authenticated with the same header token as /rpc, which is why the client
 * reads this with fetch() rather than EventSource — EventSource cannot set
 * headers, and the alternative is putting the token in a URL. */
function handleEvents(req: Request): Response {
  if (req.headers.get("x-gresui-token") !== RPC_TOKEN) {
    return rpcError(401, "Unauthorized", "invalid token");
  }
  const enc = new TextEncoder();
  const sub: {
    off?: () => void;
    heartbeat?: ReturnType<typeof setInterval>;
  } = {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (frame: string): void => {
        try {
          controller.enqueue(enc.encode(frame));
        } catch {
          // Stream already closed by the other side; cancel() cleans up.
        }
      };
      // Flush headers through any buffering proxy and tell the client the
      // stream is live before the first real event.
      send(": open\n\n");
      sub.off = events.subscribe((e) => {
        send(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      });
      // A comment frame keeps idle connections from being reaped, and gives
      // the client a way to notice a dead socket.
      sub.heartbeat = setInterval(() => send(": ping\n\n"), 25_000);
    },
    cancel() {
      sub.off?.();
      if (sub.heartbeat) clearInterval(sub.heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

// --- session state ----------------------------------------------------------

let pool: PgPool | null = null;

function primary(): PgSession {
  if (!pool) throw new Error("Not connected");
  return pool.getPrimary();
}

function sessFor(db: string): Promise<PgSession> {
  if (!pool) throw new Error("Not connected");
  return pool.get(db);
}

/** Normalize a thrown value into a plain Error the frontend can surface. */
function wrap<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    try {
      return await fn(...args);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const out = new Error(err.message);
      if (err.name && err.name !== "Error") out.name = err.name;
      throw out;
    }
  };
}

function statusOf(s: PgSession): ConnStatus {
  return {
    connected: true,
    host: s.host,
    port: s.port,
    database: s.database,
    user: s.user,
  };
}

// MCP tools run against the app's active session — same trust boundary as
// the SQL tab (the operator of gresui decides what MCP clients may see).
// PgPool.get(db) does NOT validate the name (it connects to any database
// with the connection credentials), so the configured-database allowlist is
// enforced here — never reach pool.get with an unlisted name.
const mcpCtx: mcp.Ctx = {
  getSession: (db?: string) => {
    if (!pool) throw new Error("Not connected");
    if (db === undefined) return Promise.resolve(pool.getPrimary());
    if (!pool.databases().includes(db)) {
      throw new Error(`database not in this connection: ${db}`);
    }
    return pool.get(db);
  },
  getDatabases: () => (pool ? pool.databases() : []),
  getStatus: () => (pool ? statusOf(pool.getPrimary()) : { connected: false }),
};

// --- bindings ---------------------------------------------------------------

const bindings: Bindings = {
  getSettings: () => config.getSettings(),

  setSettings: (patch: Partial<Settings>) => config.setSettings(patch),

  listConnections: () => config.listConnections(),

  saveConnection: (c: ConnectionConfig) => config.saveConnection(c),

  deleteConnection: (id: string) => config.deleteConnection(id),

  connect: async (c: ConnectionConfig): Promise<ConnStatus> => {
    if (pool) await pool.close().catch(ignoreError);
    pool = null;
    const p = new PgPool(c);
    await p.get(p.databases()[0]); // probe + cache the anchor so getPrimary() works
    pool = p;
    return statusOf(pool.getPrimary());
  },

  disconnect: async (): Promise<void> => {
    if (pool) {
      await pool.close().catch(ignoreError);
      pool = null;
    }
  },

  getStatus: (): Promise<ConnStatus> =>
    Promise.resolve(pool ? statusOf(pool.getPrimary()) : { connected: false }),

  listDatabases: (): Promise<string[]> => {
    if (!pool) throw new Error("Not connected");
    return Promise.resolve(pool.databases());
  },

  probeDatabases: async (c: ConnectionConfig): Promise<string[]> => {
    const s = new PgSession({ ...c, database: c.database || "postgres" });
    try {
      await s.connect();
      return await meta.listDatabases(s); // already excludes templates/non-connectable
    } finally {
      await s.close().catch(ignoreError);
    }
  },

  listSchemas: async (db: string) => meta.listSchemas(await sessFor(db)),

  listRelations: async (db: string, schema: string) =>
    meta.listRelations(await sessFor(db), schema),

  getTableInfo: async (db: string, schema: string, table: string) =>
    meta.getTableInfo(await sessFor(db), schema, table),

  listIndexes: async (db: string, schema: string, table: string) =>
    meta.listIndexes(await sessFor(db), schema, table),

  getRowCount: async (db: string, schema: string, table: string) =>
    meta.getRowCount(await sessFor(db), schema, table),

  browse: async (db: string, req) => data.browse(await sessFor(db), req),

  exportTable: async (db: string, req) =>
    data.exportTable(await sessFor(db), req),

  insertRow: async (
    db: string,
    schema: string,
    table: string,
    values: Record<string, CellValue>,
  ) => data.insertRow(await sessFor(db), schema, table, values),

  updateRow: async (
    db: string,
    schema: string,
    table: string,
    pkColumns: string[],
    pkValues: CellValue[],
    changes: Record<string, CellValue>,
  ) =>
    data.updateRow(
      await sessFor(db),
      schema,
      table,
      pkColumns,
      pkValues,
      changes,
    ),

  deleteRows: async (
    db: string,
    schema: string,
    table: string,
    pkColumns: string[],
    rows: CellValue[][],
  ) => data.deleteRows(await sessFor(db), schema, table, pkColumns, rows),

  runSql: (text: string, opts?: { explain?: boolean }) =>
    sql.runSql(primary(), text, opts),

  cancelQuery: () => sql.cancelQuery(primary()),

  logError: (message: string) => {
    console.error(`[frontend] ${message}`);
    return Promise.resolve();
  },

  listHistory: () => config.listHistory(),

  clearHistory: () => config.clearHistory(),

  getMcpServerInfo: () => Promise.resolve(mcp.getInfo()),

  setMcpEnabled: async (enabled: boolean) => {
    await config.setMcpEnabled(enabled);
    // Binding is async on Node — await it so getInfo() reports the real port.
    if (enabled) await mcp.start(mcpCtx);
    else await mcp.stop();
    return mcp.getInfo();
  },

  listMcpTools: () =>
    Promise.resolve(
      mcp.MCP_TOOLS.map(({ name, description }) => ({ name, description })),
    ),

  listMcpKeys: () => config.listMcpKeys(),

  listMcpUsage: () => config.listMcpUsage(),

  createMcpKey: (req) => {
    mcp.validateMcpKeyInput(req);
    return config.createMcpKey(req);
  },

  updateMcpKey: (id, patch) => {
    mcp.validateMcpKeyInput(patch);
    return config.updateMcpKey(id, patch);
  },

  deleteMcpKey: (id) => config.deleteMcpKey(id),

  setMcpLens: async (keyId, lens) => {
    mcp.validateMcpLens(lens);
    await config.setMcpLens(keyId, lens);
    return keyById(keyId);
  },

  clearMcpLens: async (keyId, table) => {
    await config.clearMcpLens(keyId, table);
    return keyById(keyId);
  },
};

/** Re-read one key after a lens change, so the caller gets the same shape
 * listMcpKeys hands out rather than having to refetch the whole list. */
async function keyById(id: string): Promise<McpKeyInfo> {
  const found = (await config.listMcpKeys()).find((k) => k.id === id);
  if (!found) throw new Error(`no such API key: ${id}`);
  return found;
}

// --- HTTP RPC ---------------------------------------------------------------

function rpcError(status: number, name: string, message: string): Response {
  return new Response(JSON.stringify({ error: { name, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function rpcJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

async function handleRpc(req: Request): Promise<Response> {
  // Token + Origin are the CSRF/cross-origin defenses (see RPC_TOKEN above).
  if (req.headers.get("x-gresui-token") !== RPC_TOKEN) {
    return rpcError(401, "Unauthorized", "invalid token");
  }
  const origin = req.headers.get("origin");
  if (origin) {
    const port = PORT;
    if (
      origin !== `http://127.0.0.1:${port}` &&
      origin !== `http://localhost:${port}`
    ) {
      return rpcError(403, "Forbidden", "invalid origin");
    }
  }

  let method: unknown;
  let args: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 1_000_000) {
      return rpcError(413, "PayloadTooLarge", "request body too large");
    }
    const body: unknown = JSON.parse(raw);
    if (body && typeof body === "object") {
      if ("method" in body) method = body.method;
      if ("args" in body) args = body.args;
    }
  } catch {
    return rpcError(400, "BadRequest", "malformed JSON body");
  }
  if (typeof method !== "string" || method === "") {
    return rpcError(400, "BadRequest", "missing method");
  }

  // Own properties only — prototype members (toString, constructor, …) are
  // not RPC methods.
  const fn = Object.hasOwn(bindings, method)
    ? (
        bindings as unknown as Record<
          string,
          (...a: unknown[]) => Promise<unknown>
        >
      )[method]
    : undefined;
  if (!fn) {
    return rpcJson({
      error: { name: "UnknownMethod", message: `no such binding: ${method}` },
    });
  }

  try {
    const result = await wrap(fn)(...(Array.isArray(args) ? args : []));
    return rpcJson({ result });
  } catch (e) {
    const obj = e as { name?: string; message?: string };
    return rpcJson({
      error: { name: obj.name ?? "Error", message: obj.message ?? String(e) },
    });
  }
}

// --- serve ------------------------------------------------------------------

const server = await serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (req) => handleRequest(req),
});
const PORT = server.port;

setupLogging();

console.log(
  `GRESUI running at http://127.0.0.1:${PORT}/ — press Ctrl+C to stop`,
);

// Re-bind the MCP listener at boot when it was enabled (persisted flag).
if (await config.getMcpEnabled()) {
  const port = await mcp.start(mcpCtx);
  console.log(`MCP server at http://127.0.0.1:${port}/mcp`);
}

// Open the default browser (best-effort).
try {
  const url = `http://127.0.0.1:${PORT}/`;
  const open: [string, ...string[]] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  const [exe, ...argv] = open;
  // A missing opener surfaces as an async "error" event (ENOENT), not a sync
  // throw — without a handler it becomes an uncaught exception and kills the
  // server. Never let that happen: the printed URL is enough.
  const child = spawn(exe, argv, { stdio: "ignore" });
  child.on("error", () => {
    // no opener available — the printed URL is enough
  });
} catch {
  // no opener available — the printed URL is enough
}
