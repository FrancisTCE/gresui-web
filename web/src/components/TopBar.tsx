import { Database, LogOut, Moon, Plug, SquareTerminal, Sun } from "lucide-react";
import { useState } from "react";

import { useAppStore } from "@/AppStore.tsx";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { call, getBindings } from "@/lib/rpc.ts";

export function TopBar({
  onOpenSql,
  onOpenMcp,
}: {
  onOpenSql(): void;
  onOpenMcp(): void;
}) {
  const { connStatus, theme, setTheme, setConnStatus, setActive, active, lastActive } = useAppStore();
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

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-raised px-3">
      <div className="flex items-center gap-2">
        <Database className="size-5 text-accent" />
        <span className="text-sm font-semibold text-foreground">GRESUI</span>
      </div>

      {active === null && lastActive ? (
        <button
          type="button"
          onClick={() => setActive(lastActive)}
          className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-background px-3 py-1 transition-colors hover:bg-surface cursor-pointer"
          aria-label="Return to last table"
        >
          <span className="size-2 rounded-full bg-accent" aria-hidden />
          <span className="font-mono text-xs text-foreground">
            {connStatus.user}@{connStatus.host}:{connStatus.port}
            {connStatus.database ? `/${connStatus.database}` : ""}
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1">
          <span className="size-2 rounded-full bg-accent" aria-hidden />
          <span className="font-mono text-xs text-foreground">
            {connStatus.user}@{connStatus.host}:{connStatus.port}
            {connStatus.database ? `/${connStatus.database}` : ""}
          </span>
        </div>
      )}
      <div className="flex items-center gap-1">
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
          <TooltipContent>Toggle theme</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="sm" onClick={onOpenMcp}>
          <Plug />
          MCP
        </Button>
        <Button variant="ghost" size="sm" onClick={onOpenSql}>
          <SquareTerminal />
          Open SQL
        </Button>
        <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm">
              <LogOut />
              Disconnect
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Disconnect?</DialogTitle>
              <DialogDescription>
                Close the connection to{" "}
                <span className="font-mono">
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
