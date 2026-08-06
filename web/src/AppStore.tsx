// App-wide state: settings, connection status, active table target, theme.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { ConnStatus, RelationKind, Settings } from "../../shared/types.ts";
import { call, getBindings } from "@/lib/rpc.ts";
import { createToastStore, ToastStoreContext, type ToastStore } from "@/lib/toast-store.ts";

export interface ActiveTarget {
  database: string;
  schema: string;
  table: string;
  kind?: RelationKind;
}

export interface AppStoreValue {
  settings: Settings;
  connStatus: ConnStatus;
  active: ActiveTarget | null;
  lastActive: ActiveTarget | null;
  theme: "dark" | "light";
  toastStore: ToastStore;
  setConnStatus(s: ConnStatus): void;
  setActive(a: ActiveTarget | null): void;
  goHome(): void;
  setTheme(t: "dark" | "light"): void;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

export function useAppStore(): AppStoreValue {
  const v = useContext(AppStoreContext);
  if (!v) throw new Error("useAppStore must be used inside AppStore provider");
  return v;
}

export function AppStoreProvider({
  settings,
  children,
}: {
  settings: Settings;
  children: ReactNode;
}) {
  const toastStore = useMemo(() => createToastStore(), []);
  const [curSettings, setCurSettings] = useState(settings);
  const [connStatus, setConnStatus] = useState<ConnStatus>({ connected: false });
  const [active, setActiveRaw] = useState<ActiveTarget | null>(null);
  const [lastActive, setLastActive] = useState<ActiveTarget | null>(null);

  function setActive(a: ActiveTarget | null): void {
    if (a) setLastActive(a);
    setActiveRaw(a);
  }

  function goHome(): void {
    setActiveRaw(null);
  }

  useEffect(() => {
    document.documentElement.classList.toggle("dark", curSettings.theme !== "light");
  }, [curSettings.theme]);

  const value = useMemo<AppStoreValue>(
    () => ({
      settings: curSettings,
      connStatus,
      active,
      lastActive,
      theme: curSettings.theme,
      toastStore,
      setConnStatus,
      setActive,
      goHome,
      setTheme: (t) => {
        document.documentElement.classList.toggle("dark", t !== "light");
        setCurSettings((s) => ({ ...s, theme: t }));
        try {
          call(getBindings().setSettings({ theme: t })).catch(() => {});
        } catch {
          // plain-browser mode: no bindings to persist to
        }
      },
    }),
    [curSettings, connStatus, active, lastActive, toastStore],
  );

  return (
    <AppStoreContext.Provider value={value}>
      <ToastStoreContext.Provider value={toastStore}>
        {children}
      </ToastStoreContext.Provider>
    </AppStoreContext.Provider>
  );
}
