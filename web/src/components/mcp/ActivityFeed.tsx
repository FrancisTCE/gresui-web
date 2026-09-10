// ActivityFeed — MCP tool calls as they happen.
//
// The point is to make an agent's reads visible while they are happening, not
// after the fact in a log: an operator who has handed a key to Claude should
// be able to watch what it actually touches. Entries arrive on the live event
// stream (see lib/sse.ts); the backend's recorded history fills in everything
// from before this tab was open, and the two are merged by row id.
//
// Both MCP panels use this. The Table panel passes a `target` so it shows only
// the open relation; the Server panel passes nothing and shows the connection.
import {
  ChevronRight,
  CircleSlash,
  Eye,
  EyeOff,
  Filter,
  Radio,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import {
  argWhere,
  describeResult,
  forTarget,
  mergeActivity,
  relTime,
} from "@/lib/mcp-activity.ts";
import { cn } from "@/lib/utils.ts";
import { useMcpActivity, useMcpStore } from "@/McpStore.tsx";
import type { McpUsageEntry } from "../../../../shared/types.ts";

export function ActivityFeed({
  /** Canonical "db.schema.table" to narrow to, or undefined for everything. */
  target,
  limit = 40,
}: {
  target?: string | undefined;
  limit?: number;
}) {
  const { usage } = useMcpStore();
  const activity = useMcpActivity();
  const [open, setOpen] = useState<number | null>(null);

  const all = mergeActivity(activity?.live ?? [], usage);
  const entries = (target === undefined ? all : forTarget(all, target)).slice(
    0,
    limit,
  );

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Agent activity
        </h3>
        <LiveDot status={activity?.status ?? "closed"} />
      </div>

      {entries.length === 0 ? (
        <p className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-6 text-sm text-muted">
          <CircleSlash className="size-4 shrink-0" />
          <span>
            {target === undefined
              ? "No MCP calls yet. They appear here the moment an agent makes one."
              : "No agent has read this table yet."}
          </span>
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-raised">
          {entries.map((e) => (
            <ActivityRow
              key={e.id}
              entry={e}
              showTarget={target === undefined}
              expanded={open === e.id}
              onToggle={() => setOpen((cur) => (cur === e.id ? null : e.id))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Whether we are attached to the stream — a dead feed must not look like a
 * quiet one, or the operator would read silence as "nothing is happening". */
function LiveDot({ status }: { status: "connecting" | "open" | "closed" }) {
  const label =
    status === "open"
      ? "Live"
      : status === "connecting"
        ? "Connecting…"
        : "Not live";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px]",
        status === "open" ? "text-accent-text" : "text-muted",
      )}
      title={
        status === "open"
          ? "Attached to the backend event stream"
          : "Showing recorded history only"
      }
    >
      <span className="relative flex size-2" aria-hidden>
        {status === "open" ? (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
        ) : null}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            status === "open"
              ? "bg-accent"
              : "border border-border-strong bg-transparent",
          )}
        />
      </span>
      {label}
    </span>
  );
}

function ActivityRow({
  entry,
  showTarget,
  expanded,
  onToggle,
}: {
  entry: McpUsageEntry;
  showTarget: boolean;
  expanded: boolean;
  onToggle(): void;
}) {
  const where = argWhere(entry);
  const lensed = entry.lens !== null;
  return (
    <li className={cn(!entry.ok && "bg-danger-soft")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface"
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-subtle transition-transform",
            expanded && "rotate-90",
          )}
          aria-hidden
        />
        <code className="shrink-0 font-mono text-xs font-medium text-foreground">
          {entry.tool}
        </code>
        {showTarget && entry.target ? (
          <code className="min-w-0 truncate font-mono text-[11px] text-muted">
            {entry.target}
          </code>
        ) : null}
        <span
          className={cn(
            "ml-auto shrink-0 text-[11px]",
            entry.ok ? "text-muted" : "text-danger-text",
          )}
        >
          {describeResult(entry)}
        </span>
        {lensed ? (
          <Badge
            variant="secondary"
            className="shrink-0 gap-1"
            title="A lens was applied"
          >
            <EyeOff />
            lens
          </Badge>
        ) : null}
        {!entry.ok ? (
          <TriangleAlert
            className="size-3.5 shrink-0 text-danger-text"
            aria-hidden
          />
        ) : null}
        <span
          className="shrink-0 text-[11px] tabular-nums text-subtle"
          title={new Date(entry.ts).toLocaleString()}
        >
          {relTime(entry.ts)}
        </span>
      </button>

      {expanded ? <ActivityDetail entry={entry} where={where} /> : null}
    </li>
  );
}

/** What the agent actually asked for and what it got back. */
function ActivityDetail({
  entry,
  where,
}: {
  entry: McpUsageEntry;
  where: string | null;
}) {
  return (
    <div className="space-y-2 border-t border-border/60 bg-background px-2.5 py-2 text-[11px]">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <Row label="Key">
          {entry.keyName ?? <em className="text-muted">revoked</em>}
        </Row>
        {entry.target ? (
          <Row label="Relation" mono>
            {entry.target}
          </Row>
        ) : null}
        <Row label="Took">{entry.durationMs} ms</Row>
        {where ? (
          <Row label="Filter" mono>
            <span className="inline-flex items-start gap-1">
              <Filter className="mt-px size-3 shrink-0 text-subtle" />
              {where}
            </span>
          </Row>
        ) : null}
        {entry.rowCount !== null ? (
          <Row label="Rows">
            {entry.rowCount}
            {entry.rowKeys === null && entry.rowCount > 0 ? (
              <span className="ml-1.5 text-subtle">
                (not identifiable — no primary key in view)
              </span>
            ) : null}
          </Row>
        ) : null}
        {entry.lens ? (
          <Row label="Lens">
            <LensSummary
              hidden={entry.lens.hiddenColumns}
              filter={entry.lens.rowFilter}
            />
          </Row>
        ) : (
          <Row label="Lens">
            <span className="inline-flex items-center gap-1 text-muted">
              <Eye className="size-3" />
              none — the whole row was visible
            </span>
          </Row>
        )}
        {entry.error ? (
          <Row label="Error" mono>
            <span className="text-danger-text">{entry.error}</span>
          </Row>
        ) : null}
      </dl>

      {entry.rowKeys && entry.rowKeys.length > 0 ? (
        <p className="text-muted">
          {entry.rowKeys.length} row
          {entry.rowKeys.length === 1 ? "" : "s"} highlighted in the grid.
        </p>
      ) : null}
    </div>
  );
}

function Row({
  label,
  mono,
  children,
}: {
  label: string;
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-subtle">{label}</dt>
      <dd
        className={cn(
          "min-w-0 break-words text-foreground",
          mono && "font-mono",
        )}
      >
        {children}
      </dd>
    </>
  );
}

export function LensSummary({
  hidden,
  filter,
}: {
  hidden: string[];
  filter: string;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {hidden.length > 0 ? (
        <>
          <EyeOff className="size-3 shrink-0 text-warning-text" />
          {hidden.map((c) => (
            <Badge
              key={c}
              variant="secondary"
              className="font-mono line-through"
            >
              {c}
            </Badge>
          ))}
        </>
      ) : null}
      {filter.trim() !== "" ? (
        <>
          <Filter className="size-3 shrink-0 text-subtle" />
          <code className="font-mono text-foreground">{filter}</code>
        </>
      ) : null}
      {hidden.length === 0 && filter.trim() === "" ? (
        <span className="text-muted">no restriction</span>
      ) : null}
    </span>
  );
}

/** The top bar's pulse: silent until an agent calls, then a brief flash. */
export function ActivityPulse() {
  const activity = useMcpActivity();
  const latest = activity?.latest ?? null;
  if (!latest) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-accent-text"
      title={`${latest.tool}${latest.target ? ` · ${latest.target}` : ""} — ${relTime(
        latest.ts,
      )}`}
    >
      <Radio className="size-3 animate-pulse" aria-hidden />
      <code className="font-mono">{latest.tool}</code>
    </span>
  );
}
