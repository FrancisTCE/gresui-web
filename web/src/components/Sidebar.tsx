// Sidebar tree: databases → schemas → relations, lazy-expanded, cached.
import { Database, Folder, Globe, Layers, RefreshCw, Search, Table2, View, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RelationKind } from "../../../shared/types.ts";
import { useAppStore } from "@/AppStore.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { formatCompact, formatCount } from "@/lib/format.ts";
import { call, getBindings } from "@/lib/rpc.ts";
import { cn } from "@/lib/utils.ts";

type TreeNode =
  | { kind: "database"; name: string }
  | { kind: "schema"; name: string }
  | {
    kind: "relation";
    name: string;
    relKind: RelationKind;
    rowEstimate: number | null;
  };

const ROOT_KEY = "";

/** Tree keys are ":"-joined paths: "" → "db" → "db:schema" → "db:schema:rel". */
function childKeyOf(parentKey: string, name: string): string {
  return parentKey === ROOT_KEY ? name : `${parentKey}:${name}`;
}

const KIND_LABEL: Record<RelationKind, string> = {
  r: "Table",
  p: "Partitioned table",
  v: "View",
  m: "Materialized view",
  f: "Foreign table",
};

function kindIcon(relKind: RelationKind) {
  switch (relKind) {
    case "v":
      return <View className="size-3.5 shrink-0 text-accent" />;
    case "m":
      return <Layers className="size-3.5 shrink-0 text-muted" />;
    case "f":
      return <Globe className="size-3.5 shrink-0 text-muted" />;
    default:
      return <Table2 className="size-3.5 shrink-0 text-accent" />;
  }
}

export function Sidebar({
  width = 256,
  refreshToken = 0,
}: {
  /** Set by the shell's drag handle. */
  width?: number;
  /** Bumped by "Refresh catalog" in the command palette. */
  refreshToken?: number;
}) {
  const { setActive, setConnStatus, toastStore, active } = useAppStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [nodes, setNodes] = useState<Record<string, TreeNode[]>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const load = useCallback(async (key: string) => {
    setLoading((s) => new Set(s).add(key));
    try {
      const b = getBindings();
      let children: TreeNode[];
      if (key === ROOT_KEY) {
        const dbs = await call(b.listDatabases());
        children = dbs.map((name) => ({ kind: "database", name }));
      } else if (key.split(":").length === 1) {
        const schemas = await call(b.listSchemas(key));
        children = schemas.map((name) => ({ kind: "schema", name }));
      } else {
        const [db, schema] = key.split(":");
        const rels = await call(b.listRelations(db, schema));
        children = rels.map((r) => ({
          kind: "relation",
          name: r.name,
          relKind: r.kind,
          rowEstimate: r.rowEstimate,
        }));
      }
      setNodes((n) => ({ ...n, [key]: children }));
    } catch (e) {
      setNodes((n) => ({ ...n, [key]: [] }));
      if (key === ROOT_KEY) {
        setConnStatus({ connected: false, error: (e as Error).message });
      } else {
        // A dead bundled db must not mark the whole connection disconnected.
        toastStore.toast({
          title: "Failed to load",
          description: (e as Error).message,
          variant: "destructive",
        });
      }
    } finally {
      setLoading((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  }, [setConnStatus, toastStore]);

  useEffect(() => {
    void load(ROOT_KEY);
  }, [load]);

  // "Refresh catalog" from the command palette. The token starts at 0 and the
  // mount effect above already loaded the root, so skip that first value.
  const firstToken = useRef(refreshToken);
  useEffect(() => {
    if (refreshToken === firstToken.current) return;
    void refresh();
  }, [refreshToken]);

  async function refresh(): Promise<void> {
    // re-query the root and every expanded level
    await load(ROOT_KEY);
    for (const key of expanded) await load(key);
  }

  function toggle(key: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else {
        next.add(key);
        if (nodes[key] === undefined) void load(key);
      }
      return next;
    });
  }

  const q = query.trim().toLowerCase();
  const matches = useCallback(
    (name: string) => !q || name.toLowerCase().includes(q),
    [q],
  );

  /** Keys whose loaded subtree holds a match. They stay visible while
   * filtering and open themselves, so a hit is actually reachable — matching
   * level-by-level used to hide the database above a matching table and so
   * emptied the entire tree. */
  const hits = useMemo(() => {
    const set = new Set<string>();
    if (!q) return set;
    const walk = (key: string): boolean => {
      const list = nodes[key];
      if (!list) return false;
      let found = false;
      for (const node of list) {
        // walk() runs before the || so deeper hits register too
        const childHit = walk(childKeyOf(key, node.name));
        if (childHit || matches(node.name)) found = true;
      }
      if (found) set.add(key);
      return found;
    };
    walk(ROOT_KEY);
    return set;
  }, [q, nodes, matches]);

  function renderChildren(key: string, indent: number): React.ReactNode {
    const list = nodes[key] ?? [];
    const isLoading = loading.has(key);
    // A container that matches by name shows everything inside it.
    const parentMatches = key !== ROOT_KEY && matches(key.split(":").pop() ?? "");
    const visible = list.filter((n) =>
      parentMatches ||
      matches(n.name) ||
      hits.has(childKeyOf(key, n.name)) ||
      // not loaded yet — keep it expandable so the user can search deeper
      (n.kind !== "relation" && nodes[childKeyOf(key, n.name)] === undefined)
    );

    if (isLoading && list.length === 0) {
      return (
        <div className="space-y-1 py-1" style={{ paddingLeft: `${indent * 14 + 30}px` }}>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      );
    }

    if (expanded.has(key) && visible.length === 0) {
      const depth = key === ROOT_KEY ? 0 : key.split(":").length;
      const label = q
        ? "No matches"
        : depth === 0
        ? "No databases"
        : depth === 1
        ? "No schemas"
        : "No tables";
      return (
        <div
          className="px-3 py-1 text-xs text-muted"
          style={{ paddingLeft: `${indent * 14 + 30}px` }}
        >
          {label}
        </div>
      );
    }

    return visible.map((node) => {
      const childKey = childKeyOf(key, node.name);
      // while filtering, a branch holding a hit opens itself
      const isOpen = expanded.has(childKey) || hits.has(childKey);

      if (node.kind === "relation") {
        const [db, schema] = key.split(":");
        const isActive = active?.database === db &&
          active?.schema === schema &&
          active?.table === node.name;
        const est = node.rowEstimate;
        return (
          <button
            key={childKey}
            type="button"
            onClick={() =>
              setActive({
                database: db,
                schema,
                table: node.name,
                kind: node.relKind,
              })}
            title={`${KIND_LABEL[node.relKind]} · ${schema}.${node.name}${
              est !== null ? ` · ~${formatCount(est)} rows` : ""
            }`}
            className={cn(
              "group relative flex w-full items-center gap-1.5 rounded-md py-1 pr-1.5 text-left text-[13px] transition-colors",
              isActive
                ? "bg-accent-soft font-medium text-foreground"
                : "text-foreground hover:bg-surface",
            )}
            style={{ paddingLeft: `${indent * 14 + 30}px` }}
          >
            {isActive ? (
              <span
                className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent"
                aria-hidden
              />
            ) : null}
            {kindIcon(node.relKind)}
            <span className="min-w-0 flex-1 truncate">
              <Highlight text={node.name} match={q} />
            </span>
            {est !== null && est > 0 ? (
              <span
                className={cn(
                  "shrink-0 rounded px-1 font-mono text-[10px] tabular-nums transition-colors",
                  isActive ? "text-accent-text" : "text-subtle group-hover:text-muted",
                )}
              >
                {formatCompact(est)}
              </span>
            ) : null}
          </button>
        );
      }

      const Icon = node.kind === "database" ? Database : Folder;
      return (
        <div key={childKey}>
          <button
            type="button"
            onClick={() => toggle(childKey)}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] text-foreground transition-colors hover:bg-surface"
            style={{ paddingLeft: `${indent * 14 + 12}px` }}
          >
            <span
              className={cn(
                "shrink-0 text-muted transition-transform",
                isOpen && "rotate-90",
              )}
            >
              <Chevron className="size-3.5" />
            </span>
            <Icon className="size-3.5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate">
              <Highlight text={node.name} match={q} />
            </span>
          </button>
          {isOpen ? renderChildren(childKey, indent + 1) : null}
        </div>
      );
    });
  }

  return (
    <aside
      className="flex shrink-0 flex-col border-r border-border bg-raised"
      style={{ width }}
    >
      <div className="flex items-center gap-1 border-b border-border p-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search tables…"
            aria-label="Search databases, schemas and tables"
            className="h-7 border-transparent bg-background/60 pl-7 pr-6 text-xs transition-colors focus-visible:bg-background"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => void refresh()}
              className="shrink-0 rounded-md p-1.5 text-muted hover:bg-surface hover:text-foreground"
              aria-label="Refresh"
            >
              <RefreshCw className={cn("size-4", loading.size > 0 && "animate-spin")} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Refresh tree</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain p-1.5">
        {nodes[ROOT_KEY] === undefined && loading.has(ROOT_KEY) ? (
          <div className="space-y-1.5 p-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-4/5" />
          </div>
        ) : null}
        {renderChildren(ROOT_KEY, 0)}
      </div>
    </aside>
  );
}

/** Marks the matched span so a search hit stands out in a long list. */
function Highlight({ text, match }: { text: string; match: string }) {
  if (!match) return <>{text}</>;
  const i = text.toLowerCase().indexOf(match);
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-accent/25 text-foreground">
        {text.slice(i, i + match.length)}
      </mark>
      {text.slice(i + match.length)}
    </>
  );
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
      aria-hidden
    >
      <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
