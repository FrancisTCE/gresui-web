// Config persistence: connections, settings, SQL history — one SQLite
// database (gresui.db) in the config directory.
//
// Passwords are AES-256-GCM encrypted at rest under a per-machine key (see
// ./secret.ts) kept in the OS keychain where available, else in gresui.key.
// Key + db are both mode 0600 and the config dir mode 0700. Decryption happens
// in-process on read; the frontend keeps receiving plaintext passwords (it is
// the app's own trust boundary).
//
// Legacy connections.json/settings.json/history.json are imported exactly once
// (on first open of a fresh DB), then removed. Rows written before encryption
// (plaintext in the db) are encrypted on first init.

import { Database } from "bun:sqlite";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";

import { timingSafeEqual } from "node:crypto";

import { decryptSecret, encryptSecret, loadKey } from "./secret.ts";
import type { KeySource } from "./secret.ts";
import type {
  ConnectionConfig,
  HistoryEntry,
  McpKeyInfo,
  Settings,
  SettingsPatch,
} from "../shared/types.ts";

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  window: { width: 1280, height: 800 },
};

export const HISTORY_CAP = 100;

/** Config directory. `GRESUI_CONFIG_DIR` overrides (used by tests). */
export function configDir(): string {
  const env = process.env.GRESUI_CONFIG_DIR;
  if (env) return env;
  const os = process.platform;
  if (os === "win32") {
    const appData = process.env.APPDATA;
    return appData
      ? `${appData}\\gresui`
      : `${process.env.USERPROFILE ?? "."}\\gresui`;
  }
  const home = process.env.HOME ?? ".";
  if (os === "darwin") return `${home}/Library/Application Support/gresui`;
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? `${xdg}/gresui` : `${home}/.config/gresui`;
}

// Per-env init (crypto.subtle is async; bun:sqlite is sync — init once, sync
// ops after). Tests swap GRESUI_CONFIG_DIR between cases.
const readyMap = new Map<string, Promise<void>>();
const stateMap = new Map<string, { dir: string; db: Database; key: CryptoKey }>();

function ensureReady(): Promise<void> {
  const env = process.env.GRESUI_CONFIG_DIR ?? "";
  let p = readyMap.get(env);
  if (!p) {
    p = init(env);
    readyMap.set(env, p);
  }
  return p;
}

function state(): { db: Database; key: CryptoKey } {
  const env = process.env.GRESUI_CONFIG_DIR ?? "";
  const s = stateMap.get(env);
  if (!s) throw new Error("gresui config not initialized");
  return s;
}

async function init(env: string): Promise<void> {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  const db = openDb(dir);
  const requested = requestedKeySource(db);
  const { key, source } = await loadKey(dir, requested);
  // Persist the chosen provider once, on first init only (never while an env
  // override is active, so a one-off override can't downgrade the install).
  if (requested === null) persistKeySource(db, source);
  await encryptLegacyRows(db, key);
  stateMap.set(env, { dir, db, key });
}

const KEY_SOURCE_ROW = "security.key_source";

/** Sticky provider: env override (file|keychain|auto), else the recorded
 * marker, else null (auto-detect). */
function requestedKeySource(db: Database): KeySource | null {
  const env = process.env.GRESUI_KEY_SOURCE;
  if (env === "keychain" || env === "file" || env === "auto") {
    return env === "auto" ? null : env;
  }
  const row = db.prepare("SELECT value FROM settings WHERE key = ?")
    .get(KEY_SOURCE_ROW) as { value?: string } | null;
  return row?.value === "keychain" || row?.value === "file" ? row.value : null;
}

function persistKeySource(db: Database, source: KeySource): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(KEY_SOURCE_ROW, source);
}

/** Encrypt any rows left plaintext (pre-encryption db or legacy JSON import).
 * GLOB (not LIKE — LIKE folds ASCII case, decryptSecret's prefix check does
 * not) so 'enc:v1:'-prefixed values are never swept and never double-encrypted. */
async function encryptLegacyRows(db: Database, key: CryptoKey): Promise<void> {
  const rows = db.prepare(
    "SELECT id, password FROM connections WHERE password NOT GLOB 'enc:v1:*'",
  ).all() as { id: string; password: string }[];
  const upd = db.prepare("UPDATE connections SET password = ? WHERE id = ?");
  for (const r of rows) upd.run(await encryptSecret(r.password, key), r.id);
}

/** True only for real db corruption. Everything else (busy/locked, IO,
 * perms) must NOT trigger recovery — renaming a healthy-but-locked db away
 * and replacing it with an empty one would destroy the other instance's data.
 * SQLite reports busy and corrupt alike as ERR_SQLITE_ERROR, so the message
 * text is the only discriminator. */
function isCorruption(err: unknown): boolean {
  const m = String((err as Error)?.message ?? err).toLowerCase();
  return m.includes("not a database") || m.includes("malformed") ||
    m.includes("disk image") || m.includes("file is encrypted");
}

function openDb(dir: string): Database {
  const path = `${dir}/gresui.db`;
  let fresh = true;
  try {
    statSync(path);
    fresh = false;
  } catch {
    // no file yet — fresh DB, legacy migration runs below
  }

  let db: Database | null = null;
  let recovered = false;
  try {
    db = new Database(path);
    // SQLite opens lazily — probe so corruption surfaces here, where we can
    // recover, instead of on the first real query. The busy_timeout absorbs
    // transient locks (a second app instance mid-write) so they are never
    // misread as corruption.
    db.exec("PRAGMA busy_timeout = 3000");
    db.prepare("SELECT 1").get();
  } catch (err) {
    if (!isCorruption(err)) throw err; // locked/busy, IO, perms — leave the file alone
    // Genuinely corrupt DB: keep a .bak, then recreate.
    try {
      db?.close();
    } catch {
      // ignore
    }
    try {
      renameSync(path, `${path}.bak`);
    } catch {
      // rename failure is fine — recreate regardless
    }
    db = new Database(path);
    db.exec("PRAGMA busy_timeout = 3000");
    recovered = true;
  }

  initSchema(db);
  if (fresh) migrateLegacy(dir, db);

  if (recovered) {
    // The original was corrupt and unreadable; its .bak may carry
    // pre-encryption-era plaintext rows. The fresh db is verified above —
    // destroy it.
    try {
      rmSync(`${path}.bak`);
    } catch {
      // already gone
    }
  }

  // Hardened perms: dir 0700, db 0600 (no-op on Windows).
  try {
    chmodSync(dir, 0o700);
    chmodSync(path, 0o600);
  } catch {
    // best-effort
  }
  return db;
}

function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      user TEXT NOT NULL,
      password TEXT NOT NULL,
      database TEXT NOT NULL,
      ssl TEXT NOT NULL,
      databases TEXT,
      last_used TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      ts TEXT NOT NULL,
      duration_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mcp_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_enc TEXT NOT NULL,
      scopes TEXT NOT NULL,
      tables TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );
  `);
  // Idempotent column migration for DBs created before the bundle feature.
  const cols = db.prepare("PRAGMA table_info(connections)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "databases")) {
    db.exec("ALTER TABLE connections ADD COLUMN databases TEXT");
  }
}

/** One-time import of the legacy JSON config files; removes them on success. */
function migrateLegacy(dir: string, db: Database): void {
  const readJson = (name: string): unknown => {
    try {
      return JSON.parse(readFileSync(`${dir}/${name}`, "utf8"));
    } catch {
      return null;
    }
  };

  let migrated = false;

  const conns = readJson("connections.json");
  if (Array.isArray(conns)) {
    const ins = db.prepare(
      `INSERT OR REPLACE INTO connections
        (id, name, host, port, user, password, database, ssl, last_used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of conns) {
      if (!c || typeof c.id !== "string") continue;
      ins.run(
        c.id,
        c.name ?? "",
        c.host ?? "",
        Number(c.port) || 5432,
        c.user ?? "",
        c.password ?? "",
        c.database ?? "",
        c.ssl ?? "disable",
        c.lastUsed ?? null,
      );
    }
    migrated = true;
  }

  const settings = readJson("settings.json");
  if (settings && typeof settings === "object") {
    const upsert = db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    );
    const s = settings as Record<string, unknown>;
    if (typeof s.theme === "string") upsert.run("theme", s.theme);
    const w = s.window as Record<string, unknown> | undefined;
    if (w) {
      for (const k of ["width", "height", "x", "y"]) {
        if (w[k] !== undefined) upsert.run(`window.${k}`, String(w[k]));
      }
    }
    migrated = true;
  }

  const hist = readJson("history.json");
  if (Array.isArray(hist)) {
    const ins = db.prepare(
      "INSERT INTO history (text, ts, duration_ms) VALUES (?, ?, ?)",
    );
    for (const h of hist) {
      if (!h || typeof h.text !== "string") continue;
      ins.run(h.text, String(h.ts ?? ""), Number(h.durationMs) || 0);
    }
    migrated = true;
  }

  if (migrated) {
    for (const f of ["connections.json", "settings.json", "history.json"]) {
      try {
        rmSync(`${dir}/${f}`);
      } catch {
        // already gone
      }
    }
  }
}

// --- connections -----------------------------------------------------------

function rowToConfig(r: Record<string, unknown>): Omit<ConnectionConfig, "password"> {
  const ssl = r.ssl === "require" || r.ssl === "verify" ? r.ssl : "disable";
  let databases: string[] | undefined;
  if (r.databases) {
    try {
      const parsed = JSON.parse(String(r.databases));
      if (Array.isArray(parsed)) {
        databases = parsed.filter((d): d is string => typeof d === "string" && d !== "");
      }
    } catch {
      // corrupt row → treat as no bundle
    }
  }
  return {
    id: String(r.id),
    name: String(r.name),
    host: String(r.host),
    port: Number(r.port),
    user: String(r.user),
    database: String(r.database),
    ssl,
    ...(databases?.length ? { databases } : {}),
    ...(r.last_used ? { lastUsed: String(r.last_used) } : {}),
  };
}

export async function listConnections(): Promise<ConnectionConfig[]> {
  await ensureReady();
  const { db, key } = state();
  const rows = db
    .prepare("SELECT * FROM connections ORDER BY rowid")
    .all() as Record<string, unknown>[];
  return await Promise.all(
    rows.map(async (r) => ({
      ...rowToConfig(r),
      password: await decryptSecret(String(r.password), key),
    })),
  );
}

export async function saveConnection(c: ConnectionConfig): Promise<ConnectionConfig[]> {
  await ensureReady();
  const { db, key } = state();
  const password = await encryptSecret(c.password, key);
  db.prepare(
    `INSERT INTO connections (id, name, host, port, user, password, database, ssl, databases, last_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       host = excluded.host,
       port = excluded.port,
       user = excluded.user,
       password = excluded.password,
       database = excluded.database,
       ssl = excluded.ssl,
       databases = excluded.databases,
       last_used = excluded.last_used`,
  ).run(
    c.id,
    c.name,
    c.host,
    c.port,
    c.user,
    password,
    c.database,
    c.ssl,
    c.databases?.length ? JSON.stringify(c.databases) : null,
    c.lastUsed ?? null,
  );
  return listConnections();
}

export async function deleteConnection(id: string): Promise<ConnectionConfig[]> {
  await ensureReady();
  state().db.prepare("DELETE FROM connections WHERE id = ?").run(id);
  return listConnections();
}

// --- settings --------------------------------------------------------------

export async function getSettings(): Promise<Settings> {
  await ensureReady();
  const { db } = state();
  const rows = db
    .prepare("SELECT key, value FROM settings")
    .all() as Record<string, string>[];
  const flat: Record<string, string> = {};
  for (const r of rows) flat[r.key] = r.value;
  const s: Settings = {
    theme: flat.theme === "light" ? "light" : "dark",
    window: {
      width: flat["window.width"] !== undefined
        ? Number(flat["window.width"])
        : DEFAULT_SETTINGS.window.width,
      height: flat["window.height"] !== undefined
        ? Number(flat["window.height"])
        : DEFAULT_SETTINGS.window.height,
    },
  };
  if (flat["window.x"] !== undefined) s.window.x = Number(flat["window.x"]);
  if (flat["window.y"] !== undefined) s.window.y = Number(flat["window.y"]);
  return s;
}

export async function setSettings(patch: SettingsPatch): Promise<Settings> {
  const cur = await getSettings();
  const next: Settings = {
    ...cur,
    ...patch,
    window: { ...cur.window, ...(patch.window ?? {}) },
  };
  const { db } = state();
  const upsert = db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
  );
  upsert.run("theme", next.theme);
  for (const k of ["width", "height", "x", "y"] as const) {
    const v = next.window[k];
    if (v !== undefined) upsert.run(`window.${k}`, String(v));
  }
  return next;
}

// --- history ---------------------------------------------------------------

export async function listHistory(): Promise<HistoryEntry[]> {
  await ensureReady();
  const { db } = state();
  const rows = db
    .prepare(
      "SELECT text, ts, duration_ms FROM history ORDER BY ts DESC, id DESC",
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    text: String(r.text),
    ts: String(r.ts),
    durationMs: Number(r.duration_ms),
  }));
}

/** Push an entry; cap at HISTORY_CAP, newest first. */
export async function pushHistory(entry: HistoryEntry): Promise<void> {
  await ensureReady();
  const { db } = state();
  db.prepare(
    "INSERT INTO history (text, ts, duration_ms) VALUES (?, ?, ?)",
  ).run(entry.text, entry.ts, entry.durationMs);
  db.prepare(
    `DELETE FROM history WHERE id NOT IN
      (SELECT id FROM history ORDER BY id DESC LIMIT ?)`,
  ).run(HISTORY_CAP);
}

export async function clearHistory(): Promise<void> {
  await ensureReady();
  state().db.prepare("DELETE FROM history").run();
}

// --- MCP --------------------------------------------------------------------

const MCP_ENABLED_ROW = "mcp.enabled";

export async function getMcpEnabled(): Promise<boolean> {
  await ensureReady();
  const row = state().db.prepare("SELECT value FROM settings WHERE key = ?")
    .get(MCP_ENABLED_ROW) as { value?: string } | null;
  return row?.value === "1";
}

export async function setMcpEnabled(v: boolean): Promise<void> {
  await ensureReady();
  state().db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(MCP_ENABLED_ROW, v ? "1" : "0");
}

function generateApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "gresui_" + btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Constant-time-ish compare (length check first — timingSafeEqual throws on
 * unequal lengths, and lengths of valid keys are identical anyway). */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function rowToMcpKey(
  r: Record<string, unknown>,
  decrypted: string,
): McpKeyInfo {
  return {
    id: String(r.id),
    name: String(r.name),
    key: decrypted,
    scopes: JSON.parse(String(r.scopes)) as string[],
    tables: JSON.parse(String(r.tables)) as string[],
    createdAt: String(r.created_at),
    lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
  };
}

export async function createMcpKey(req: {
  name: string;
  scopes: string[];
  tables: string[];
}): Promise<McpKeyInfo> {
  await ensureReady();
  const { db, key } = state();
  const raw = generateApiKey();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO mcp_keys (id, name, key_enc, scopes, tables, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    req.name,
    await encryptSecret(raw, key),
    JSON.stringify(req.scopes),
    JSON.stringify(req.tables),
    now,
  );
  return {
    id,
    name: req.name,
    key: raw,
    scopes: req.scopes,
    tables: req.tables,
    createdAt: now,
    lastUsedAt: null,
  };
}

export async function updateMcpKey(
  id: string,
  patch: { name?: string; scopes?: string[]; tables?: string[] },
): Promise<McpKeyInfo> {
  await ensureReady();
  const { db, key } = state();
  const existing = db.prepare("SELECT * FROM mcp_keys WHERE id = ?")
    .get(id) as Record<string, unknown> | null;
  if (!existing) throw new Error(`no such API key: ${id}`);
  const name = patch.name ?? String(existing.name);
  const scopes = patch.scopes ?? (JSON.parse(String(existing.scopes)) as string[]);
  const tables = patch.tables ?? (JSON.parse(String(existing.tables)) as string[]);
  db.prepare(
    "UPDATE mcp_keys SET name = ?, scopes = ?, tables = ? WHERE id = ?",
  ).run(name, JSON.stringify(scopes), JSON.stringify(tables), id);
  return rowToMcpKey(
    { ...existing, name, scopes: JSON.stringify(scopes), tables: JSON.stringify(tables) },
    await decryptSecret(String(existing.key_enc), key),
  );
}

export async function deleteMcpKey(id: string): Promise<void> {
  await ensureReady();
  state().db.prepare("DELETE FROM mcp_keys WHERE id = ?").run(id);
}

export async function listMcpKeys(): Promise<McpKeyInfo[]> {
  await ensureReady();
  const { db, key } = state();
  const rows = db
    .prepare("SELECT * FROM mcp_keys ORDER BY created_at, rowid")
    .all() as Record<string, unknown>[];
  return await Promise.all(
    rows.map(async (r) =>
      rowToMcpKey(r, await decryptSecret(String(r.key_enc), key))
    ),
  );
}

/** Decrypt-scan lookup by raw key value; never logs the key. */
export async function findMcpKeyByValue(raw: string): Promise<McpKeyInfo | null> {
  await ensureReady();
  const { db, key } = state();
  const rows = db
    .prepare("SELECT * FROM mcp_keys")
    .all() as Record<string, unknown>[];
  for (const r of rows) {
    const decrypted = await decryptSecret(String(r.key_enc), key);
    if (decrypted.length > 0 && timingSafeEqualStr(decrypted, raw)) {
      return rowToMcpKey(r, decrypted);
    }
  }
  return null;
}

export async function touchMcpKey(id: string): Promise<void> {
  await ensureReady();
  state().db.prepare(
    "UPDATE mcp_keys SET last_used_at = ? WHERE id = ?",
  ).run(new Date().toISOString(), id);
}
