// Main shell: TopBar + Sidebar + tabbed content (Table | SQL | Info | MCP).
import { Table2, Info as InfoIcon, Plug, SquareTerminal, MousePointerSquareDashed } from "lucide-react";
import { useEffect, useState } from "react";

import { useAppStore } from "@/AppStore.tsx";
import { Sidebar } from "@/components/Sidebar.tsx";
import { TopBar } from "@/components/TopBar.tsx";
import { InfoTab } from "@/components/tabs/InfoTab.tsx";
import { McpTab } from "@/components/tabs/McpTab.tsx";
import { SqlTab } from "@/components/tabs/SqlTab.tsx";
import { TableTab } from "@/components/tabs/TableTab.tsx";
import { cn } from "@/lib/utils.ts";

export type TabId = "table" | "sql" | "info" | "mcp";

const TABS: { id: TabId; label: string; icon: typeof Table2 }[] = [
  { id: "table", label: "Table", icon: Table2 },
  { id: "sql", label: "SQL", icon: SquareTerminal },
  { id: "info", label: "Info", icon: InfoIcon },
  { id: "mcp", label: "MCP", icon: Plug },
];

export function MainShell() {
  const { active } = useAppStore();
  const [tab, setTab] = useState<TabId>("table");

  // clicking a relation opens its Table tab
  useEffect(() => {
    if (active) setTab("table");
  }, [active?.table]);

  return (
    <div className="flex h-full flex-col bg-background">
      <TopBar onOpenSql={() => setTab("sql")} onOpenMcp={() => setTab("mcp")} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-end gap-0.5 border-b border-border px-2">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "flex h-full items-center gap-1.5 border-b-2 px-3 text-[13px] font-medium transition-colors",
                  tab === id
                    ? "border-accent text-foreground"
                    : "border-transparent text-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
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
          <div className={cn("min-h-0 flex-1", tab !== "mcp" && "hidden")}>
            <McpTab tabActive={tab === "mcp"} />
          </div>
        </main>
      </div>
    </div>
  );
}

/** Empty state shown when no relation is selected. */
export function NoTableSelected() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background text-center">
      <MousePointerSquareDashed className="size-10 text-muted/50" />
      <p className="text-sm text-muted">
        Select a table from the sidebar to browse its data.
      </p>
    </div>
  );
}
