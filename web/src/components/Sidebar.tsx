// Sidebar tree: databases → schemas → relations, lazy-expanded, cached.
import { Database, Folder, Globe, Layers, RefreshCw, Search, Table2, View } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { RelationKind } from "../../../shared/types.ts";
import { useAppStore } from "@/AppStore.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Input } from "@/components/ui/input.tsx";
import { call, getBindings } from "@/lib/rpc.ts";

type TreeNode =
  | { kind: "database"; name: string }
  | { kind: "schema"; name: string }
  | { kind: "relation"; name: string; relKind: RelationKind };

const ROOT_KEY = "";

function kindIcon(relKind: RelationKind) {
  switch (relKind) {
    case "v":
      return <View className="size-3.5 text-accent" />;
    case "m":
      return <Layers className="size-3.5 text-muted" />;
    case "f":
      return <Globe className="size-3.5 text-muted" />;
    default:
      return <Table2 className="size-3.5 text-accent" />;
  }
}

export function Sidebar() {
  const { setActive, setConnStatus, toastStore } = useAppStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [nodes, setNodes] = useState<Record<string, TreeNode[]>>({});
  const [estimates, setEstimates] = useState<Record<string, number | null>>({});
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
        void load(key);
      }
      return next;
    });
  }

  async function openRelation(
    db: string,
    schema: string,
    table: string,
    kind?: RelationKind,
  ): Promise<void> {
    const estKey = `${db}:${schema}:${table}`;
    if (!(estKey in estimates)) {
      try {
        const info = await call(getBindings().getTableInfo(db, schema, table));
        setEstimates((m) => ({ ...m, [estKey]: info.rowEstimate }));
      } catch {
        // non-fatal; badge just stays hidden
      }
    }
    setActive({ database: db, schema, table, kind });
  }

  const q = query.trim().toLowerCase();
  const matches = (name: string) => !q || name.toLowerCase().includes(q);

  function renderChildren(key: string, indent: number): React.ReactNode {
    const list = nodes[key] ?? [];
    const isLoading = loading.has(key);
    const parentMatches = key === ROOT_KEY ? false : matches(key.split(":").pop() ?? "");
    const visible = parentMatches ? list : list.filter((n) => matches(n.name));

    if (isLoading && list.length === 0) {
      return (
        <div
          className="py-1"
          style={{ paddingLeft: `${indent * 14 + 30}px` }}
        >
          <Skeleton className="h-4 w-3/4" />
        </div>
      );
    }

    if (expanded.has(key) && visible.length === 0) {
      const label = key === ROOT_KEY
        ? "No databases"
        : key.indexOf(":") === -1
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
      const childKey =
        node.kind === "database"
          ? node.name
          : node.kind === "schema"
          ? `${key}:${node.name}`
          : `${key}:${node.name}`;
      const isOpen = expanded.has(childKey);

      if (node.kind === "relation") {
        const est = estimates[`${key}:${node.name}`];
        return (
          <button
            key={childKey}
            type="button"
            onClick={() => {
              const [db, schema] = key.split(":");
              void openRelation(db, schema, node.name, node.relKind);
            }}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] text-foreground hover:bg-surface"
            style={{ paddingLeft: `${indent * 14 + 30}px` }}
          >
            {kindIcon(node.relKind)}
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            {est !== undefined && est !== null ? (
              <span className="shrink-0 rounded-full bg-surface px-1.5 text-[10px] text-muted">
                {est}
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
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] text-foreground hover:bg-surface"
            style={{ paddingLeft: `${indent * 14 + 12}px` }}
          >
            <span
              className={`text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}
            >
              <Chevron className="size-3.5" />
            </span>
            <Icon className="size-3.5 text-accent" />
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
          </button>
          {isOpen
            ? renderChildren(childKey, indent + 1)
            : null}
        </div>
      );
    });
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-raised">
      <div className="flex items-center gap-1.5 border-b border-border p-2">
        <Search className="ml-1 size-4 shrink-0 text-muted" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          className="h-7 border-transparent bg-transparent focus-visible:bg-background"
        />
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-foreground"
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw className="size-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
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
