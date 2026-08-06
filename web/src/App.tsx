import { useEffect, useState } from "react";

import type { Settings } from "../../shared/types.ts";
import { AppStoreProvider, useAppStore } from "./AppStore.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { ConnectScreen } from "./screens/ConnectScreen.tsx";
import { MainShell } from "./screens/MainShell.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Toaster } from "@/components/ui/toast.tsx";
import { call, getBindings } from "@/lib/rpc.ts";

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await call(getBindings().getSettings());
        if (alive) setSettings(s);
      } catch {
        if (alive) {
          setSettings({ theme: "dark", window: { width: 1280, height: 800 } });
        }
      }
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
    <AppStoreProvider settings={settings}>
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
        {connStatus.connected ? <MainShell /> : <ConnectScreen />}
        <Toaster />
      </TooltipProvider>
  );
}
