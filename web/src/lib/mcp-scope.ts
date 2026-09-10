// How an MCP API key's table allowlist relates to one relation.
//
// The allowlist stores "schema.table" or "db.schema.table"; an unqualified
// entry means the anchor database (the one named in ConnStatus.database).
// Both forms have to compare equal, or a key written one way would look
// unrelated to a relation addressed the other — see backend/mcp.ts, which
// canonicalizes the same way before it allows a call.

import type { McpKeyInfo } from "../../../shared/types.ts";

/** A relation as the UI addresses it. */
export interface TableRef {
  database: string;
  schema: string;
  table: string;
}

/** "db.schema.table" — the form the allowlist is compared in. */
export function canonicalTable(ref: string, anchorDb: string): string {
  return ref.split(".").length === 2 ? `${anchorDb}.${ref}` : ref;
}

/** The allowlist entry we write for a relation: qualified unless it is the
 * anchor database, where the shorter form is what people expect to read. */
export function tableEntry(t: TableRef, anchorDb: string): string {
  return t.database === anchorDb
    ? `${t.schema}.${t.table}`
    : `${t.database}.${t.schema}.${t.table}`;
}

/** Always-qualified label, for display where the database matters. */
export function qualifiedTable(t: TableRef): string {
  return `${t.database}.${t.schema}.${t.table}`;
}

/** How a key reaches a relation:
 *  - "all"      — no allowlist, so every table (including this one) is exposed
 *  - "explicit" — this relation is named in the allowlist
 *  - null       — the key cannot reach it */
export type Coverage = "all" | "explicit" | null;

export function keyCoverage(
  key: McpKeyInfo,
  target: TableRef,
  anchorDb: string,
): Coverage {
  if (key.tables.length === 0) return "all";
  const want = canonicalTable(qualifiedTable(target), anchorDb);
  return key.tables.some((t) => canonicalTable(t, anchorDb) === want)
    ? "explicit"
    : null;
}

/** The allowlist with `target` removed, in whichever form it was written. */
export function withoutTable(
  key: McpKeyInfo,
  target: TableRef,
  anchorDb: string,
): string[] {
  const want = canonicalTable(qualifiedTable(target), anchorDb);
  return key.tables.filter((t) => canonicalTable(t, anchorDb) !== want);
}

/** The allowlist with `target` added; a no-op when it is already covered. */
export function withTable(
  key: McpKeyInfo,
  target: TableRef,
  anchorDb: string,
): string[] {
  if (keyCoverage(key, target, anchorDb) !== null) return key.tables;
  return [...key.tables, tableEntry(target, anchorDb)];
}
