// TopBar — identity, breadcrumb to the open relation, command trigger, actions.
import {
  ChevronRight,
  Database,
  Folder,
  LogOut,
  Moon,
  Search,
  Server,
  SquareTerminal,
  Sun,
  Table2,
  View,
} from "lucide-react";
import { useState } from "react";

import { useAppStore } from "@/AppStore.tsx";
import { useMcpStore } from "@/McpStore.tsx";
import { ServerStateDot } from "@/components/mcp/McpShared.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { Kbd } from "@/components/ui/kbd.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { call, getBindings } from "@/lib/rpc.ts";
import { isMac } from "@/lib/platform.ts";

export function TopBar({
  onOpenSql,
  onOpenMcpServer,
  onOpenPalette,
}: {
  onOpenSql(): void;
  /** Connection-wide MCP. The relation-scoped one is the Table MCP tab —
   * the top bar never opens that, or the two would be the same door. */
  onOpenMcpServer(): void;
  onOpenPalette(): void;
}) {
  const {
    connStatus,
    theme,
    setTheme,
    setConnStatus,
    setActive,
    active,
    lastActive,
  } = useAppStore();
  const { server, keys } = useMcpStore();
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  async function disconnect(): Promise<void> {
    setDisconnectOpen(false);
    try {
      await call(getBindings().disconnect());
    } catch {
      // even if the call fails, return to the connect screen
    }
    setConnStatus({ connected: false });
    setActive(null);
  }

  const crumbs = active ?? lastActive;
  const stale = active === null && lastActive !== null;
  const RelIcon = crumbs?.kind === "v" || crumbs?.kind === "m" ? View : Table2;

  return (
    <header className="relative flex h-11 shrink-0 items-center gap-3 border-b border-border bg-raised px-3">
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex size-6 items-center justify-center rounded-md bg-accent/15">
          <Database className="size-3.5 text-accent-text" />
        </div>
        <span className="text-[13px] font-semibold tracking-tight text-foreground">
          GRESUI
        </span>
      </div>

      {crumbs
        ? (
          <>
            <div className="h-4 w-px shrink-0 bg-border" />
            {/* Whole breadcrumb is one control: while the table view is empty
                it walks back to the relation that was last open. */}
            <button
              type="button"
              onClick={() => stale && setActive(lastActive)}
              disabled={!stale}
              title={stale
                ? `Back to ${crumbs.schema}.${crumbs.table}`
                : `${crumbs.database} / ${crumbs.schema} / ${crumbs.table}`}
              className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors enabled:hover:bg-surface disabled:cursor-default"
            >
              <Database className="size-3 shrink-0 text-subtle" />
              <span className="max-w-[9rem] truncate text-muted">
                {crumbs.database}
              </span>
              <ChevronRight className="size-3 shrink-0 text-subtle" />
              <Folder className="size-3 shrink-0 text-subtle" />
              <span className="max-w-[9rem] truncate text-muted">
                {crumbs.schema}
              </span>
              <ChevronRight className="size-3 shrink-0 text-subtle" />
              <RelIcon className="size-3 shrink-0 text-accent-text" />
              <span className="max-w-[14rem] truncate font-medium text-foreground">
                {crumbs.table}
              </span>
            </button>
          </>
        )
        : null}

      {/* Centred independently of the breadcrumb, which changes width as the
          user moves between relations. */}
      <button
        type="button"
        onClick={onOpenPalette}
        className="absolute left-1/2 hidden h-7 w-[clamp(180px,22vw,300px)] -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs text-subtle transition-colors hover:border-border-strong hover:text-muted lg:flex"
        aria-label="Open command palette"
      >
        <Search className="size-3.5 shrink-0" />
        <span className="flex-1 text-left">Search tables…</span>
        <Kbd className="h-4 border-transparent bg-surface px-1 text-[10px]">
          {isMac() ? "⌘K" : "Ctrl K"}
        </Kbd>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={onOpenPalette}
              aria-label="Search tables"
            >
              <Search />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Search tables</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={onOpenMcpServer}>
              <Server />
              MCP Server
              {server?.enabled ? (
                <ServerStateDot enabled className="ml-0.5" />
              ) : null}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {server?.enabled
              ? `Serving ${keys.length} connection${keys.length === 1 ? "" : "s"}`
              : "MCP server is stopped"}
            {" · this connection, all tables"}
          </TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="sm" onClick={onOpenSql}>
          <SquareTerminal />
          SQL
        </Button>
        <div className="mx-1 h-4 w-px bg-border" />
        <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
          {/* Tooltip must be the outer wrapper: DialogTrigger's asChild needs a
              DOM node to hand its props to, and Tooltip.Root is not one — with
              the nesting the other way round the click never reached the
              button and the dialog never opened. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Disconnect">
                  <LogOut />
                </Button>
              </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>Disconnect</TooltipContent>
          </Tooltip>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Disconnect?</DialogTitle>
              <DialogDescription>
                Close the connection to{" "}
                <span className="font-mono text-foreground">
                  {connStatus.host}:{connStatus.port}
                </span>
                ?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDisconnectOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={disconnect}>
                Disconnect
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </header>
  );
}
