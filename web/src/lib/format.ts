// Number formatting shared by the sidebar badges and the row-count readouts.

/** Full count with thousands separators: 49829069 -> "49,829,069". */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** Compact count for tight spots (sidebar badges): 49829069 -> "49.8M".
 * Under 1000 stays exact so small tables read precisely. */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1000) return String(n);
  const units = [
    { limit: 1e12, suffix: "T" },
    { limit: 1e9, suffix: "B" },
    { limit: 1e6, suffix: "M" },
    { limit: 1e3, suffix: "K" },
  ];
  for (const { limit, suffix } of units) {
    if (n >= limit) {
      const v = n / limit;
      // one decimal below 10 (9.4M), none above (94M) — keeps badges narrow
      return `${v < 10 ? v.toFixed(1).replace(/.0$/, "") : Math.round(v)}${suffix}`;
    }
  }
  return String(n);
}

/** "today" / "3 days ago" / "12 Mar 2025" — a saved connection's age is a
 * rough sense of recency, not a date you need to read exactly. Falls back to
 * an absolute date past a month, where "37 days ago" stops meaning anything. */
export function formatRelativeDate(iso: string | number | Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days < 0)
    return then.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return then.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "49,829,069 rows" / "~49.8M rows" for the browse footer. */
export function formatRowCount(total: number, estimated: boolean): string {
  const n = estimated ? `~${formatCompact(total)}` : formatCount(total);
  return `${n} row${total === 1 && !estimated ? "" : "s"}`;
}
