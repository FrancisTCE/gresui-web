// Main shell: TopBar + resizable Sidebar + tabbed content + StatusBar.
import {
  Info as InfoIcon,
  MousePointerSquareDashed,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Search,
  Server,
  SquareTerminal,
  Table2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAppStore } from "@/AppStore.tsx";
import { useMcpStore } from "@/McpStore.tsx";
import { CommandPalette } from "@/components/CommandPalette.tsx";
import { Sidebar } from "@/components/Sidebar.tsx";
import { StatusBar } from "@/components/StatusBar.tsx";
import { TopBar } from "@/components/TopBar.tsx";
import { InfoTab } from "@/components/tabs/InfoTab.tsx";
import { McpServerTab } from "@/components/tabs/McpServerTab.tsx";
import { TableMcpTab } from "@/components/tabs/TableMcpTab.tsx";
import { SqlTab } from "@/components/tabs/SqlTab.tsx";
import { TableTab } from "@/components/tabs/TableTab.tsx";
import { ServerStateDot } from "@/components/mcp/McpShared.tsx";
import { Kbd } from "@/components/ui/kbd.tsx";
import { isModifier, modKeyLabel } from "@/lib/platform.ts";
import { cn } from "@/lib/utils.ts";

export type TabId = "table" | "sql" | "info" | "tableMcp" | "mcpServer";

/** The two MCP tabs are separated by a rule: everything up to it is about the
 * relation in front of the user, "MCP Server" is about the whole connection.
 * They used to be one tab reachable two ways, which is why nobody could tell
 * which scope they had opened. */
const TABS: {
  id: TabId;
  label: string;
  icon: typeof Table2;
  /** Draw the group separator before this tab. */
  divider?: boolean;
}[] = [
  { id: "table", label: "Table", icon: Table2 },
  { id: "sql", label: "SQL", icon: SquareTerminal },
  { id: "info", label: "Info", icon: InfoIcon },
  { id: "tableMcp", label: "Table MCP", icon: Plug },
  { id: "mcpServer", label: "MCP Server", icon: Server, divider: true },
];

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 520;
const SIDEBAR_DEFAULT = 256;
const SIDEBAR_KEY = "gresui.sidebarWidth";

function storedWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY);
    const n = raw === null ? NaN : Number(raw);
    if (Number.isFinite(n)) return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n));
  } catch {
    // private mode / blocked storage — the default is fine
  }
  return SIDEBAR_DEFAULT;
}

export function MainShell() {
  const { active } = useAppStore();
  const { server } = useMcpStore();
  const [tab, setTab] = useState<TabId>("table");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(storedWidth);
  const [collapsed, setCollapsed] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const dragging = useRef(false);

  // clicking a relation opens its Table tab
  useEffect(() => {
    if (active) setTab("table");
    // Keyed on the table name alone: switching relations opens the Table tab,
    // but a change to any other field of `active` must not yank the user out
    // of the tab they are in.
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies
  }, [active?.table]);

  // Global shortcuts. Typing in an input must never be swallowed, so the
  // single-key ones bail out when focus is in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (isModifier(e) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (isModifier(e) && e.key === "b") {
        e.preventDefault();
        setCollapsed((v) => !v);
        return;
      }
      if (isModifier(e) && e.key >= "1" && e.key <= "5") {
        const next = TABS[Number(e.key) - 1];
        if (next) {
          e.preventDefault();
          setTab(next.id);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const startDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startW = sidebarWidth;
    // Pointer capture on the handle would end the drag the moment the pointer
    // outran it; listen on the window instead.
    const onMove = (ev: PointerEvent): void => {
      if (!dragging.current) return;
      const w = Math.min(
        SIDEBAR_MAX,
        Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX)),
      );
      setSidebarWidth(w);
    };
    const onUp = (): void => {
      dragging.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      setSidebarWidth((w) => {
        try {
          localStorage.setItem(SIDEBAR_KEY, String(w));
        } catch {
          // nothing to do — the width just won't survive a reload
        }
        return w;
      });
    };
    // Without these the drag selects text across the whole app.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [sidebarWidth]);

  return (
    <div className="flex h-full flex-col bg-background">
      <TopBar
        onOpenSql={() => setTab("sql")}
        onOpenMcpServer={() => setTab("mcpServer")}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        {collapsed ? null : (
          <>
            <Sidebar width={sidebarWidth} refreshToken={refreshToken} />
            {/* 1px seam, 9px grab area — a hairline is the right look and the
                wrong hit target. */}
            <div
              onPointerDown={startDrag}
              onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT)}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              title="Drag to resize · double-click to reset"
              className="group relative -ml-px w-[9px] shrink-0 cursor-col-resize"
            >
              <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-accent group-active:bg-accent" />
            </div>
          </>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-stretch gap-1 border-b border-border px-1.5">
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              title={`${collapsed ? "Show" : "Hide"} sidebar (${modKeyLabel()}+B)`}
              aria-label={`${collapsed ? "Show" : "Hide"} sidebar`}
              className="my-auto flex size-6 items-center justify-center rounded-md text-subtle transition-colors hover:bg-surface hover:text-foreground"
            >
              {collapsed
                ? <PanelLeftOpen className="size-4" />
                : <PanelLeftClose className="size-4" />}
            </button>
            <div className="my-auto h-4 w-px bg-border" />
            {TABS.map(({ id, label, icon: Icon, divider }) => (
              <div key={id} className="flex items-stretch">
                {divider ? <div className="my-auto mr-1.5 h-4 w-px bg-border" /> : null}
              <button
                type="button"
                onClick={() => setTab(id)}
                aria-current={tab === id}
                title={`${label} (${modKeyLabel()}+${TABS.findIndex((t) => t.id === id) + 1})`}
                className={cn(
                  "relative flex items-center gap-1.5 px-2.5 text-[13px] font-medium transition-colors",
                  tab === id
                    ? "text-foreground"
                    : "text-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
                {/* A running server is worth seeing from anywhere. */}
                {id === "mcpServer" && server?.enabled
                  ? <ServerStateDot enabled className="ml-0.5" />
                  : null}
                {/* Indicator rides the button rather than a shared track, so it
                    cross-fades between tabs instead of sliding through them. */}
                <span
                  className={cn(
                    "absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-accent transition-opacity",
                    tab === id ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
              </div>
            ))}
          </div>
          <div className={cn("min-h-0 flex-1", tab !== "table" && "hidden")}>
            <TableTab tabActive={tab === "table"} />
          </div>
          <div className={cn("min-h-0 flex-1", tab !== "sql" && "hidden")}>
            <SqlTab active={tab === "sql"} />
          </div>
          <div className={cn("min-h-0 flex-1", tab !== "info" && "hidden")}>
            <InfoTab />
          </div>
          <div className={cn("min-h-0 flex-1", tab !== "tableMcp" && "hidden")}>
            <TableMcpTab
              tabActive={tab === "tableMcp"}
              onOpenServer={() => setTab("mcpServer")}
            />
          </div>
          <div className={cn("min-h-0 flex-1", tab !== "mcpServer" && "hidden")}>
            <McpServerTab tabActive={tab === "mcpServer"} />
          </div>
        </main>
      </div>
      <StatusBar />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onOpenSql={() => setTab("sql")}
        onOpenTableMcp={() => setTab("tableMcp")}
        onOpenMcpServer={() => setTab("mcpServer")}
        onRefresh={() => setRefreshToken((t) => t + 1)}
      />
    </div>
  );
}

/** Empty state shown when no relation is selected. */
export function NoTableSelected() {
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center animate-slide-up">
        <div className="flex size-12 items-center justify-center rounded-xl bg-accent/10">
          <MousePointerSquareDashed className="size-6 text-accent-text" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">No table selected</p>
          <p className="text-sm text-muted">
            Pick a table in the sidebar to browse its rows, or jump straight to
            the SQL editor.
          </p>
        </div>
        <ul className="w-full space-y-2 text-left text-xs text-muted">
          <li className="flex items-center gap-2">
            <Search className="size-3.5 shrink-0 text-subtle" />
            <span>
              Press <Kbd>{modKeyLabel()} K</Kbd> to jump to any table by name.
            </span>
          </li>
          <li className="flex items-center gap-2">
            <SquareTerminal className="size-3.5 shrink-0 text-subtle" />
            <span>
              Open <span className="font-medium text-foreground">SQL</span>{" "}
              and run a query with <Kbd>{modKeyLabel()} ↵</Kbd>.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
