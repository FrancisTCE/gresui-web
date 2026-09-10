// Shaping MCP tool calls for the activity feed.
//
// The feed has two sources that overlap: the history the backend hands over on
// load, and the live stream. An entry can legitimately appear in both (a
// refresh that races an event), so everything here keys off the backend's own
// row id rather than timestamps, which can tie.

import type { McpUsageEntry } from "../../../shared/types.ts";
import { formatCount } from "./format.ts";

/** Live entries first, then history, deduped by id, newest first. */
export function mergeActivity(
  live: readonly McpUsageEntry[],
  history: readonly McpUsageEntry[] | null,
): McpUsageEntry[] {
  const byId = new Map<number, McpUsageEntry>();
  for (const e of history ?? []) byId.set(e.id, e);
  // Live wins on a tie: same row, but it is the copy the stream published.
  for (const e of live) byId.set(e.id, e);
  return [...byId.values()].toSorted((a, b) => b.id - a.id);
}

/** Only the calls that touched one relation. */
export function forTarget(
  entries: readonly McpUsageEntry[],
  target: string,
): McpUsageEntry[] {
  return entries.filter((e) => e.target === target);
}

/** Only the calls made by one key. */
export function forKey(
  entries: readonly McpUsageEntry[],
  keyId: string,
): McpUsageEntry[] {
  return entries.filter((e) => e.keyId === keyId);
}

/** "just now" / "12s ago" / "4m ago" / "2h ago", then the date. Coarse on
 * purpose: the exact timestamp is in the title attribute. */
export function relTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 3) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(then).toLocaleDateString();
}

/** What the call did, in a phrase. Reads left to right as "read 12 rows from
 * public.users" — the feed puts the tool name next to it, so this describes
 * the outcome rather than repeating the verb. */
export function describeResult(e: McpUsageEntry): string {
  if (!e.ok) return e.error ?? "failed";
  if (e.rowCount === null) return "ok";
  if (e.tool === "row_count") {
    return `counted ${formatCount(e.rowCount)}`;
  }
  return `${formatCount(e.rowCount)} row${e.rowCount === 1 ? "" : "s"}`;
}

/** The `where` the agent asked for, if any — the single most interesting
 * argument, and the one worth showing without expanding the entry. */
export function argWhere(e: McpUsageEntry): string | null {
  const w = e.args?.where;
  return typeof w === "string" && w.trim() !== "" ? w : null;
}
