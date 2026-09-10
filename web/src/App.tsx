import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Toaster } from "@/components/ui/toast.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { call, getBindings } from "@/lib/rpc.ts";
import type { ConnStatus, Settings } from "../../shared/types.ts";
import { AppStoreProvider, useAppStore } from "./AppStore.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { McpStoreProvider } from "./McpStore.tsx";
import { ConnectScreen } from "./screens/ConnectScreen.tsx";
import { MainShell } from "./screens/MainShell.tsx";

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  // The backend owns the connection, not the page. Ask it what it has, so a
  // reload lands back in the session instead of on the connect screen.
  const [initialConn, setInitialConn] = useState<ConnStatus>({
    connected: false,
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      const b = getBindings();
      const [s, status] = await Promise.allSettled([
        call(b.getSettings()),
        call(b.getStatus()),
      ]);
      if (!alive) return;
      setInitialConn(
        status.status === "fulfilled" ? status.value : { connected: false },
      );
      setSettings(
        s.status === "fulfilled"
          ? s.value
          : { theme: "dark", window: { width: 1280, height: 800 } },
      );
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Skeleton className="size-24 rounded-full" />
      </div>
    );
  }

  return (
    <AppStoreProvider settings={settings} initialConnStatus={initialConn}>
      <ErrorBoundary>
        <Gate />
      </ErrorBoundary>
    </AppStoreProvider>
  );
}

function Gate() {
  const { connStatus } = useAppStore();
  return (
    <TooltipProvider delayDuration={300}>
      {/* MCP state is only meaningful with a live session, and the shell,
            the top bar and both MCP panels have to read the same copy of it. */}
      {connStatus.connected ? (
        <McpStoreProvider>
          <MainShell />
        </McpStoreProvider>
      ) : (
        <ConnectScreen />
      )}
      <Toaster />
    </TooltipProvider>
  );
}
