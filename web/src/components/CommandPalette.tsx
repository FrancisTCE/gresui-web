// Command palette (Ctrl/Cmd+K) — jump to any table, or run an action.
//
// The sidebar loads its tree lazily, one level per click; the palette needs
// the opposite. It walks every database and schema once on first open and
// keeps the flat list, so typing a table name finds it whether or not that
// branch has ever been expanded.
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  CornerDownLeft,
  Database,
  Layers,
  Loader2,
  Moon,
  Plug,
  RefreshCw,
  Search,
  Server,
  SquareTerminal,
  Sun,
  Table2,
  View,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { RelationKind } from "../../../shared/types.ts";
import { useAppStore, type ActiveTarget } from "@/AppStore.tsx";
import { Kbd } from "@/components/ui/kbd.tsx";
import { crawlCatalog, type CatalogTable } from "@/lib/catalog.ts";
import { fuzzyMatch, splitMatch } from "@/lib/fuzzy.ts";
import { formatCompact } from "@/lib/format.ts";
import { cn } from "@/lib/utils.ts";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon: typeof Table2;
  run(): void;
}

/** The catalog row, named locally for what the palette does with it. */
type TableEntry = CatalogTable;

type Item =
  | { type: "table"; key: string; entry: TableEntry; positions: number[] }
  | { type: "action"; key: string; action: PaletteAction; positions: number[] };

function kindIcon(kind: RelationKind) {
  if (kind === "v" || kind === "m") return View;
  return Table2;
}

export function CommandPalette({
  open,
  onOpenChange,
  onOpenSql,
  onOpenTableMcp,
  onOpenMcpServer,
  onRefresh,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onOpenSql(): void;
  onOpenTableMcp(): void;
  onOpenMcpServer(): void;
  onRefresh(): void;
}) {
  const { setActive, theme, setTheme, connStatus, active } = useAppStore();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [tables, setTables] = useState<TableEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<ActiveTarget[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const loadTables = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setTables(await crawlCatalog());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    if (tables === null && connStatus.connected) void loadTables();
  }, [open, tables, connStatus.connected, loadTables]);

  // A new connection invalidates the index.
  useEffect(() => {
    setTables(null);
    setRecent([]);
    // The three fields are the trigger; the body reads none of them.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [connStatus.connected, connStatus.host, connStatus.database]);

  const actions = useMemo<PaletteAction[]>(() => [
    {
      id: "sql",
      label: "Open SQL editor",
      hint: "Run a query",
      icon: SquareTerminal,
      run: onOpenSql,
    },
    {
      id: "table-mcp",
      label: active
        ? `MCP access for ${active.schema}.${active.table}`
        : "MCP access for this table",
      hint: "Which connections can read this relation",
      icon: Plug,
      run: onOpenTableMcp,
    },
    {
      id: "mcp-server",
      label: "Open MCP server settings",
      hint: "The server and every connection to it",
      icon: Server,
      run: onOpenMcpServer,
    },
    {
      id: "refresh",
      label: "Refresh catalog",
      hint: "Re-read databases, schemas and tables",
      icon: RefreshCw,
      run: () => {
        setTables(null);
        onRefresh();
      },
    },
    {
      id: "theme",
      label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      icon: theme === "dark" ? Sun : Moon,
      run: () => setTheme(theme === "dark" ? "light" : "dark"),
    },
  ], [onOpenSql, onOpenTableMcp, onOpenMcpServer, onRefresh, theme, setTheme, active]);

  const { tableItems, actionItems } = useMemo(() => {
    const q = query.trim();
    const ti: Item[] = [];
    const ai: Item[] = [];

    if (q === "") {
      // Nothing typed: recents first, then a slice of the catalog so the
      // palette is never an empty box.
      const recentKeys = new Set(
        recent.map((r) => `${r.database}:${r.schema}:${r.table}`),
      );
      for (const r of recent) {
        const hit = (tables ?? []).find(
          (t) =>
            t.database === r.database && t.schema === r.schema &&
            t.table === r.table,
        );
        if (hit) {
          ti.push({
            type: "table",
            key: `${hit.database}:${hit.search}`,
            entry: hit,
            positions: [],
          });
        }
      }
      for (const t of tables ?? []) {
        if (ti.length >= 12) break;
        if (recentKeys.has(`${t.database}:${t.schema}:${t.table}`)) continue;
        ti.push({
          type: "table",
          key: `${t.database}:${t.search}`,
          entry: t,
          positions: [],
        });
      }
      for (const a of actions) {
        ai.push({ type: "action", key: a.id, action: a, positions: [] });
      }
      return { tableItems: ti, actionItems: ai };
    }

    const scoredT: { item: Item; score: number }[] = [];
    for (const t of tables ?? []) {
      const m = fuzzyMatch(q, t.search);
      if (!m) continue;
      scoredT.push({
        item: {
          type: "table",
          key: `${t.database}:${t.search}`,
          entry: t,
          positions: m.positions,
        },
        score: m.score,
      });
    }
    scoredT.sort((a, b) => b.score - a.score);

    const scoredA: { item: Item; score: number }[] = [];
    for (const a of actions) {
      const m = fuzzyMatch(q, a.label);
      if (!m) continue;
      scoredA.push({
        item: { type: "action", key: a.id, action: a, positions: m.positions },
        score: m.score,
      });
    }
    scoredA.sort((a, b) => b.score - a.score);

    return {
      tableItems: scoredT.slice(0, 60).map((s) => s.item),
      actionItems: scoredA.map((s) => s.item),
    };
  }, [query, tables, actions, recent]);

  const items = useMemo(
    () => [...tableItems, ...actionItems],
    [tableItems, actionItems],
  );

  // Clamp rather than reset: the cursor should survive a backspace.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
    // `items` is here so a changed list re-runs the scroll, not because the
    // body reads it.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [cursor, items]);

  function choose(item: Item): void {
    onOpenChange(false);
    if (item.type === "action") {
      item.action.run();
      return;
    }
    const t = item.entry;
    const target: ActiveTarget = {
      database: t.database,
      schema: t.schema,
      table: t.table,
      kind: t.kind,
    };
    setRecent((prev) =>
      [
        target,
        ...prev.filter(
          (p) =>
            !(p.database === target.database && p.schema === target.schema &&
              p.table === target.table),
        ),
      ].slice(0, 5)
    );
    setActive(target);
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      setCursor((c) => (items.length === 0 ? 0 : (c + 1) % items.length));
    } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      setCursor((c) =>
        items.length === 0 ? 0 : (c - 1 + items.length) % items.length
      );
    } else if (e.key === "Home") {
      e.preventDefault();
      setCursor(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setCursor(Math.max(0, items.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[cursor];
      if (item) choose(item);
    }
  }

  let index = -1;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] animate-fade-in" />
        <DialogPrimitive.Content
          onKeyDown={onKeyDown}
          className="fixed left-1/2 top-[12vh] z-50 flex max-h-[70vh] w-[min(640px,92vw)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border-strong bg-overlay shadow-lg animate-pop-in"
          aria-label="Command palette"
        >
          <DialogPrimitive.Title className="sr-only">
            Command palette
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search tables and actions. Arrow keys to move, Enter to run.
          </DialogPrimitive.Description>

          <div className="flex items-center gap-2.5 border-b border-border px-3.5">
            {loading
              ? <Loader2 className="size-4 shrink-0 animate-spin text-muted" />
              : <Search className="size-4 shrink-0 text-muted" />}
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              placeholder="Search tables and actions…"
              aria-label="Search tables and actions"
              className="h-12 min-w-0 flex-1 rounded-lg bg-transparent text-[15px] text-foreground placeholder:text-subtle focus-visible:-outline-offset-2"
            />
            <Kbd className="shrink-0">Esc</Kbd>
          </div>

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1.5">
            {items.length === 0
              ? (
                <div className="px-4 py-10 text-center text-sm text-muted">
                  {loading
                    ? "Reading the catalog…"
                    : query.trim()
                    ? (
                      <>
                        No match for{" "}
                        <span className="font-mono text-foreground">
                          {query.trim()}
                        </span>
                      </>
                    )
                    : "Nothing to show yet."}
                </div>
              )
              : null}

            {tableItems.length > 0
              ? (
                <Group label={query.trim() ? "Tables" : recent.length ? "Recent & tables" : "Tables"}>
                  {tableItems.map((item) => {
                    index++;
                    const i = index;
                    const t = item.type === "table" ? item.entry : null;
                    if (!t) return null;
                    const Icon = kindIcon(t.kind);
                    return (
                      <Row
                        key={item.key}
                        active={i === cursor}
                        onMouseEnter={() => setCursor(i)}
                        onClick={() => choose(item)}
                        icon={<Icon className="size-4 shrink-0 text-accent-text" />}
                        title={
                          <Marked
                            text={t.search}
                            positions={item.positions}
                          />
                        }
                        meta={
                          <>
                            {t.rowEstimate !== null && t.rowEstimate > 0
                              ? (
                                <span className="font-mono text-[11px] tabular-nums text-subtle">
                                  {formatCompact(t.rowEstimate)}
                                </span>
                              )
                              : null}
                            <span className="flex items-center gap-1 text-[11px] text-subtle">
                              <Database className="size-3" />
                              {t.database}
                            </span>
                          </>
                        }
                      />
                    );
                  })}
                </Group>
              )
              : null}

            {actionItems.length > 0
              ? (
                <Group label="Actions">
                  {actionItems.map((item) => {
                    index++;
                    const i = index;
                    if (item.type !== "action") return null;
                    const Icon = item.action.icon;
                    return (
                      <Row
                        key={item.key}
                        active={i === cursor}
                        onMouseEnter={() => setCursor(i)}
                        onClick={() => choose(item)}
                        icon={<Icon className="size-4 shrink-0 text-muted" />}
                        title={
                          <Marked
                            text={item.action.label}
                            positions={item.positions}
                          />
                        }
                        meta={item.action.hint
                          ? (
                            <span className="text-[11px] text-subtle">
                              {item.action.hint}
                            </span>
                          )
                          : null}
                      />
                    );
                  })}
                </Group>
              )
              : null}
          </div>

          <div className="flex shrink-0 items-center gap-3 border-t border-border bg-raised px-3.5 py-2 text-[11px] text-subtle">
            <span className="flex items-center gap-1">
              <Kbd className="h-4 px-1 text-[10px]">↑</Kbd>
              <Kbd className="h-4 px-1 text-[10px]">↓</Kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <Kbd className="h-4 px-1 text-[10px]">
                <CornerDownLeft className="size-2.5" />
              </Kbd>
              open
            </span>
            {tables !== null
              ? (
                <span className="ml-auto flex items-center gap-1">
                  <Layers className="size-3" />
                  {tables.length} relations indexed
                </span>
              )
              : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-1">
      <div className="px-3.5 py-1 text-[10px] font-semibold uppercase text-subtle">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({
  active,
  icon,
  title,
  meta,
  onClick,
  onMouseEnter,
}: {
  active: boolean;
  icon: ReactNode;
  title: ReactNode;
  meta: ReactNode;
  onClick(): void;
  onMouseEnter(): void;
}) {
  return (
    <button
      type="button"
      data-active={active}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      // Mouse-down would steal focus from the input and close the palette.
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left text-[13px] transition-colors",
        active ? "bg-accent-soft text-foreground" : "text-foreground",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="flex shrink-0 items-center gap-2.5">{meta}</span>
    </button>
  );
}

/** Renders the fuzzy hit positions as emphasised runs. */
function Marked({ text, positions }: { text: string; positions: number[] }) {
  return (
    <>
      {splitMatch(text, positions).map((run, i) => (
        <span
          // Positional slices of one string: the index is what identifies a
          // run, and two runs can hold the same text.
          // oxlint-disable-next-line react/no-array-index-key
          key={i}
          className={run.hit ? "font-semibold text-accent-text" : undefined}
        >
          {run.text}
        </span>
      ))}
    </>
  );
}
