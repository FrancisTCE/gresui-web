// PostgreSQL connection strings ⇄ ConnectionConfig.
//
// Two forms are accepted, because those are the two people actually have in
// hand — the URI a hosted provider gives you, and the keyword/value DSN the
// psql docs use:
//
//   postgresql://user:pass@host:5432/dbname?sslmode=require
//   host=localhost port=5432 dbname=mydb user=postgres sslmode=require
//
// Parsing is deliberately lossy in one direction only: this app exposes three
// SSL modes where libpq has six, so a downgrade is reported as a warning
// rather than applied silently.

import type { ConnectionConfig } from "../../../shared/types.ts";

/** The connection fields a string can carry. `id`/`name` are the app's own. */
export type ParsedConnection = Pick<
  ConnectionConfig,
  "host" | "port" | "user" | "password" | "database" | "ssl"
>;

export interface ParseResult {
  ok: boolean;
  value?: ParsedConnection;
  error?: string;
  /** Lossy mappings and dropped parameters — shown, never applied silently. */
  warnings: string[];
}

const DEFAULT_PORT = 5432;

/** libpq sslmode → this app's three modes. `allow`/`prefer` are opportunistic,
 * which the driver here cannot express, so they land on the honest floor. */
const SSL_MODES: Record<string, { ssl: ParsedConnection["ssl"]; warn?: string }> = {
  disable: { ssl: "disable" },
  allow: {
    ssl: "disable",
    warn: "sslmode=allow is opportunistic; using Disable (no encryption).",
  },
  prefer: {
    ssl: "disable",
    warn: "sslmode=prefer is opportunistic; using Disable (no encryption).",
  },
  require: { ssl: "require" },
  "verify-ca": { ssl: "verify" },
  "verify-full": { ssl: "verify" },
};

/** Parameters that map onto a field; everything else is reported as dropped. */
const KNOWN_PARAMS = new Set([
  "host",
  "hostaddr",
  "port",
  "dbname",
  "database",
  "user",
  "password",
  "sslmode",
]);

/** Cheap sniff so callers can decide whether a pasted blob looks like a
 * connection string at all (e.g. paste into the Host field). */
export function looksLikeConnectionString(s: string): boolean {
  const t = s.trim();
  if (/^postgres(ql)?:\/\//i.test(t)) return true;
  // Two or more libpq keywords is a DSN; one could be an ordinary hostname.
  const kv = t.match(/\b(host|hostaddr|port|dbname|user|password|sslmode)=/gi);
  return kv !== null && kv.length >= 2;
}

function applySslMode(
  raw: string | undefined,
  out: ParsedConnection,
  warnings: string[],
): string | undefined {
  if (raw === undefined) return undefined;
  const mode = SSL_MODES[raw.trim().toLowerCase()];
  if (!mode) return `Unknown sslmode "${raw}".`;
  out.ssl = mode.ssl;
  if (mode.warn) warnings.push(mode.warn);
  return undefined;
}

/** A libpq host list ("a:5432,b:5433") — this app connects to one server. */
function firstHost(host: string, warnings: string[]): string {
  if (!host.includes(",")) return host;
  const [first = host] = host.split(",");
  warnings.push(
    "Multiple hosts given; using the first. Failover lists are not supported.",
  );
  return first;
}

/** IPv6 arrives bracketed from both the URI and DSN forms; the driver wants
 * the bare address. */
function unbracket(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function parsePort(
  raw: string,
  warnings: string[],
): { port?: number; error?: string } {
  const first = raw.includes(",") ? raw.split(",")[0] : raw;
  const n = Number(first);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    return { error: `Invalid port "${raw}".` };
  }
  if (raw.includes(",")) {
    warnings.push("Multiple ports given; using the first.");
  }
  return { port: n };
}

function parseUri(text: string): ParseResult {
  const warnings: string[] = [];
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    // URL() reports an out-of-range port as a plain parse failure; dig the
    // port out of the authority so the message names the real problem.
    const authority = text.slice(text.indexOf("//") + 2).split(/[/?#]/)[0] ?? "";
    const portMatch = authority.match(/:(\d+)$/);
    if (portMatch && Number(portMatch[1]) > 65535) {
      return { ok: false, error: `Invalid port "${portMatch[1]}".`, warnings };
    }
    return { ok: false, error: "Not a valid URI.", warnings };
  }

  const out: ParsedConnection = {
    host: "127.0.0.1",
    port: DEFAULT_PORT,
    user: "",
    password: "",
    database: "",
    ssl: "disable",
  };

  // decodeURIComponent, not the URL getters: those hand back the still-encoded
  // form, so a password of "p@ss word" would arrive as "p%40ss%20word".
  const decode = (s: string, what: string): string | null => {
    try {
      return decodeURIComponent(s);
    } catch {
      warnings.push(`Could not decode the ${what}; using it as written.`);
      return s;
    }
  };

  if (url.username) out.user = decode(url.username, "username") ?? "";
  if (url.password) out.password = decode(url.password, "password") ?? "";
  // An empty hostname is legal ("postgres:///mydb") and means local.
  if (url.hostname) out.host = unbracket(firstHost(url.hostname, warnings));
  if (url.port) {
    const { port, error } = parsePort(url.port, warnings);
    if (error) return { ok: false, error, warnings };
    out.port = port ?? DEFAULT_PORT;
  }

  const path = url.pathname.replace(/^\//, "");
  if (path) out.database = decode(path, "database name") ?? "";

  const dropped: string[] = [];
  for (const [key, value] of url.searchParams) {
    const k = key.toLowerCase();
    if (!KNOWN_PARAMS.has(k)) {
      dropped.push(key);
      continue;
    }
    if (k === "sslmode") {
      const err = applySslMode(value, out, warnings);
      if (err) return { ok: false, error: err, warnings };
    } else if (k === "host" || k === "hostaddr") {
      out.host = unbracket(firstHost(value, warnings));
    } else if (k === "port") {
      const { port, error } = parsePort(value, warnings);
      if (error) return { ok: false, error, warnings };
      out.port = port ?? DEFAULT_PORT;
    } else if (k === "dbname" || k === "database") {
      out.database = value;
    } else if (k === "user") {
      out.user = value;
    } else if (k === "password") {
      out.password = value;
    }
  }
  if (dropped.length > 0) {
    warnings.push(`Ignored parameter${dropped.length > 1 ? "s" : ""}: ${dropped.join(", ")}.`);
  }

  return { ok: true, value: out, warnings };
}

/** Split a libpq DSN into key/value pairs, honouring single-quoted values and
 * backslash escapes ("password='p a\\'ss'"). */
function splitDsn(text: string): { pairs: [string, string][]; error?: string } {
  const pairs: [string, string][] = [];
  let i = 0;
  const n = text.length;
  /** The character at `j`; "" past the end. Every call site is already
   * inside `i < n`, so this only satisfies the type, never the logic. */
  const at = (j: number): string => text[j] ?? "";
  while (i < n) {
    while (i < n && /\s/.test(at(i))) i++;
    if (i >= n) break;

    const keyStart = i;
    while (i < n && at(i) !== "=" && !/\s/.test(at(i))) i++;
    const key = text.slice(keyStart, i);
    while (i < n && /\s/.test(at(i))) i++;
    if (i >= n || at(i) !== "=") {
      return { pairs, error: `Expected "=" after "${key}".` };
    }
    i++; // consume "="
    while (i < n && /\s/.test(at(i))) i++;

    let value = "";
    if (i < n && at(i) === "'") {
      i++;
      let closed = false;
      while (i < n) {
        if (at(i) === "\\" && i + 1 < n) {
          value += at(i + 1);
          i += 2;
          continue;
        }
        if (at(i) === "'") {
          i++;
          closed = true;
          break;
        }
        value += at(i++);
      }
      if (!closed) return { pairs, error: `Unterminated quote in "${key}".` };
    } else {
      while (i < n && !/\s/.test(at(i))) {
        if (at(i) === "\\" && i + 1 < n) {
          value += at(i + 1);
          i += 2;
          continue;
        }
        value += at(i++);
      }
    }
    pairs.push([key.toLowerCase(), value]);
  }
  return { pairs };
}

function parseDsn(text: string): ParseResult {
  const warnings: string[] = [];
  const { pairs, error } = splitDsn(text);
  if (error) return { ok: false, error, warnings };
  if (pairs.length === 0) {
    return { ok: false, error: "No parameters found.", warnings };
  }

  const out: ParsedConnection = {
    host: "127.0.0.1",
    port: DEFAULT_PORT,
    user: "",
    password: "",
    database: "",
    ssl: "disable",
  };

  const dropped: string[] = [];
  for (const [key, value] of pairs) {
    switch (key) {
      case "host":
      case "hostaddr":
        out.host = unbracket(firstHost(value, warnings));
        break;
      case "port": {
        const { port, error: portErr } = parsePort(value, warnings);
        if (portErr) return { ok: false, error: portErr, warnings };
        out.port = port ?? DEFAULT_PORT;
        break;
      }
      case "dbname":
      case "database":
        out.database = value;
        break;
      case "user":
        out.user = value;
        break;
      case "password":
        out.password = value;
        break;
      case "sslmode": {
        const sslErr = applySslMode(value, out, warnings);
        if (sslErr) return { ok: false, error: sslErr, warnings };
        break;
      }
      default:
        dropped.push(key);
    }
  }
  if (dropped.length > 0) {
    warnings.push(`Ignored parameter${dropped.length > 1 ? "s" : ""}: ${dropped.join(", ")}.`);
  }

  return { ok: true, value: out, warnings };
}

/**
 * Parse a connection string in either the URI or the keyword/value form.
 * Never throws — a bad string comes back as `{ ok: false, error }`.
 */
export function parseConnectionString(text: string): ParseResult {
  const t = text.trim();
  if (t === "") return { ok: false, error: "", warnings: [] };
  if (/^postgres(ql)?:\/\//i.test(t)) return parseUri(t);
  if (/^[a-z]+:\/\//i.test(t)) {
    return {
      ok: false,
      error: "Only postgres:// and postgresql:// URIs are supported.",
      warnings: [],
    };
  }
  if (!t.includes("=")) {
    return {
      ok: false,
      error:
        "Expected a postgresql:// URI, or key=value pairs such as 'host=… dbname=…'.",
      warnings: [],
    };
  }
  return parseDsn(t);
}

/** The reverse: build a URI from the fields currently in the form. */
export function formatConnectionString(
  cfg: ParsedConnection,
  opts: { maskPassword?: boolean } = {},
): string {
  const enc = encodeURIComponent;
  let auth = "";
  if (cfg.user) {
    auth = enc(cfg.user);
    if (cfg.password) {
      auth += `:${opts.maskPassword ? "••••••" : enc(cfg.password)}`;
    }
    auth += "@";
  }
  // Bare IPv6 needs its brackets back before it can go in a URI.
  const host = cfg.host.includes(":") && !cfg.host.startsWith("[")
    ? `[${cfg.host}]`
    : cfg.host;
  const port = cfg.port === DEFAULT_PORT ? "" : `:${cfg.port}`;
  const db = cfg.database ? `/${enc(cfg.database)}` : "";
  const sslmode = cfg.ssl === "disable"
    ? ""
    : `?sslmode=${cfg.ssl === "require" ? "require" : "verify-full"}`;
  return `postgresql://${auth}${host}${port}${db}${sslmode}`;
}

/** One-line human summary of a parsed string, for the confirmation row. */
export function describeConnection(c: ParsedConnection): string {
  const who = c.user ? `${c.user}@` : "";
  // Bracket IPv6, or its colons run straight into the port's.
  const host = c.host.includes(":") ? `[${c.host}]` : c.host;
  const db = c.database ? `/${c.database}` : "";
  const ssl = c.ssl === "disable" ? "no SSL" : `SSL ${c.ssl}`;
  return `${who}${host}:${c.port}${db} · ${ssl}`;
}
