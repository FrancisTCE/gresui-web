// App-wide state: settings, connection status, active table target, theme.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { call, getBindings } from "@/lib/rpc.ts";
import {
  createToastStore,
  type ToastStore,
  ToastStoreContext,
} from "@/lib/toast-store.ts";
import { ignoreError } from "../../shared/noop.ts";
import type { ConnStatus, RelationKind, Settings } from "../../shared/types.ts";

/** What the status bar shows about the view in front of the user. Published
 * by whichever tab is active; the shell only renders it. */
export interface ViewStatus {
  /** Rows currently rendered. */
  rows?: number;
  /** Rows the query matches in total. */
  total?: number;
  /** `total` is a planner estimate rather than a count. */
  estimated?: boolean;
  /** Round-trip of the last fetch, in ms. */
  elapsedMs?: number;
  /** Free-text state ("Loading…", an error) shown instead of the counts. */
  label?: string;
}

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
  viewStatus: ViewStatus;
  setConnStatus(s: ConnStatus): void;
  setActive(a: ActiveTarget | null): void;
  goHome(): void;
  setTheme(t: "dark" | "light"): void;
  setViewStatus(s: ViewStatus): void;
}

/** Paint the theme, and leave a hint index.html can read before the next
 * load's first paint — the authoritative value lives in the backend's
 * settings and only arrives after React has already mounted. */
function applyTheme(theme: "dark" | "light"): void {
  const el = document.documentElement;
  el.classList.toggle("dark", theme !== "light");
  // Without this, form controls and scrollbars keep the previous theme's
  // native styling until reload.
  el.style.colorScheme = theme;
  try {
    localStorage.setItem("gresui.theme", theme);
  } catch {
    // private mode / blocked storage — only costs a flash on the next load
  }
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

export function useAppStore(): AppStoreValue {
  const v = useContext(AppStoreContext);
  if (!v) throw new Error("useAppStore must be used inside AppStore provider");
  return v;
}

export function AppStoreProvider({
  settings,
  initialConnStatus = { connected: false },
  children,
}: {
  settings: Settings;
  /** Status the backend reported at boot — non-empty after a page reload of a
   * still-connected session. */
  initialConnStatus?: ConnStatus;
  children: ReactNode;
}) {
  const toastStore = useMemo(() => createToastStore(), []);
  const [curSettings, setCurSettings] = useState(settings);
  const [connStatus, setConnStatus] = useState<ConnStatus>(initialConnStatus);
  const [active, setActiveRaw] = useState<ActiveTarget | null>(null);
  const [lastActive, setLastActive] = useState<ActiveTarget | null>(null);
  const [viewStatus, setViewStatus] = useState<ViewStatus>({});

  const setActive = useCallback((a: ActiveTarget | null): void => {
    if (a) setLastActive(a);
    setActiveRaw(a);
  }, []);

  const goHome = useCallback((): void => {
    setActiveRaw(null);
  }, []);

  useEffect(() => {
    applyTheme(curSettings.theme);
  }, [curSettings.theme]);

  const value = useMemo<AppStoreValue>(
    () => ({
      settings: curSettings,
      connStatus,
      active,
      lastActive,
      theme: curSettings.theme,
      toastStore,
      viewStatus,
      setConnStatus,
      setActive,
      goHome,
      setViewStatus,
      setTheme: (t) => {
        applyTheme(t); // ahead of the state round-trip, so the click feels instant
        setCurSettings((s) => ({ ...s, theme: t }));
        try {
          call(getBindings().setSettings({ theme: t })).catch(ignoreError);
        } catch {
          // plain-browser mode: no bindings to persist to
        }
      },
    }),
    [
      curSettings,
      connStatus,
      active,
      lastActive,
      toastStore,
      viewStatus,
      setActive,
      goHome,
    ],
  );

  return (
    <AppStoreContext.Provider value={value}>
      <ToastStoreContext.Provider value={toastStore}>
        {children}
      </ToastStoreContext.Provider>
    </AppStoreContext.Provider>
  );
}
