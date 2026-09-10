// MCP state, shared by the three places that show it: the top bar badge, the
// MCP Server tab (the whole connection) and the Table MCP tab (one relation).
// They have to agree — a key created from the table tab has to appear in the
// server tab, and revoking one there has to clear the table tab's badge — so
// the fetch and the mutations live here rather than in either panel.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAppStore } from "@/AppStore.tsx";
import { call, getBindings } from "@/lib/rpc.ts";
import { openEventStream, type StreamStatus } from "@/lib/sse.ts";
import type {
  McpKeyInfo,
  McpLens,
  McpServerInfo,
  McpToolInfo,
  McpUsageEntry,
} from "../../shared/types.ts";

export interface McpStoreValue {
  server: McpServerInfo | null;
  keys: McpKeyInfo[];
  tools: McpToolInfo[];
  /** null until the first load lands. */
  usage: McpUsageEntry[] | null;
  loading: boolean;
  refresh(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  createKey(req: {
    name: string;
    scopes: string[];
    tables: string[];
  }): Promise<McpKeyInfo>;
  updateKey(
    id: string,
    patch: { name?: string; scopes?: string[]; tables?: string[] },
  ): Promise<McpKeyInfo>;
  deleteKey(id: string): Promise<void>;
  /** Narrow what one key sees of one table. Hiding nothing and filtering
   * nothing removes the lens. */
  setLens(keyId: string, lens: McpLens): Promise<void>;
  clearLens(keyId: string, table: string): Promise<void>;
}

/** Live MCP traffic. Split from the store above because it changes on every
 * tool call: a component that only needs the key list must not re-render
 * because an agent read a row. */
export interface McpActivityValue {
  /** Whether we are actually attached to the backend's event stream. */
  status: StreamStatus;
  /** Calls seen since the app opened, newest first (capped). Replayed history
   * is not included — this is the live tail only. */
  live: McpUsageEntry[];
  /** The most recent call, for the top bar's heartbeat. */
  latest: McpUsageEntry | null;
  /** rowKey() of every row an agent read from `target` in the last few
   * seconds — what the grid flashes. */
  reads(target: string): ReadonlySet<string>;
}

const McpStoreContext = createContext<McpStoreValue | null>(null);
const McpActivityContext = createContext<McpActivityValue | null>(null);

/** How long a row stays lit after an agent read it. Long enough to notice
 * when you are looking elsewhere on screen, short enough that the grid is not
 * permanently striped green. */
const FLASH_MS = 6000;
/** Live tail depth. The full history is on `usage`, from the backend. */
const LIVE_CAP = 200;

export function useMcpStore(): McpStoreValue {
  const v = useContext(McpStoreContext);
  if (!v) throw new Error("useMcpStore must be used inside McpStoreProvider");
  return v;
}

/** Null outside the provider — the grid and the top bar render fine with no
 * live feed, so they ask rather than require. */
export function useMcpActivity(): McpActivityValue | null {
  return useContext(McpActivityContext);
}

export function McpStoreProvider({ children }: { children: ReactNode }) {
  const { toastStore } = useAppStore();
  const [server, setServer] = useState<McpServerInfo | null>(null);
  const [keys, setKeys] = useState<McpKeyInfo[]>([]);
  const [tools, setTools] = useState<McpToolInfo[]>([]);
  const [usage, setUsage] = useState<McpUsageEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [live, setLive] = useState<McpUsageEntry[]>([]);
  /** Calls whose rows are still lit, newest first. Separate from `live`
   * because it expires on a timer while the feed keeps its entries. */
  const [flashing, setFlashing] = useState<McpUsageEntry[]>([]);
  const timers = useRef<number[]>([]);

  const refresh = useCallback(async () => {
    const b = getBindings();
    setLoading(true);
    try {
      const [i, ks, ts, u] = await Promise.all([
        call(b.getMcpServerInfo()),
        call(b.listMcpKeys()),
        call(b.listMcpTools()),
        call(b.listMcpUsage()),
      ]);
      setServer(i);
      setKeys(ks);
      setTools(ts);
      setUsage(u);
    } catch (e) {
      toastStore.toast({
        title: "Failed to load MCP settings",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toastStore]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The live stream. Agents call the MCP listener, not the RPC this frontend
  // drives, so without this there is nothing to poll at the moment a call
  // happens — and the whole point is to see it happen.
  useEffect(() => {
    const close = openEventStream({
      onStatus: setStatus,
      onEvent(e) {
        if (e.type !== "mcp-activity") return;
        const entry = e.entry;
        // The same entry can arrive twice: once live, once in a refresh that
        // raced it. `id` is the backend's own row id, so it settles that.
        setLive((prev) =>
          prev.some((p) => p.id === entry.id)
            ? prev
            : [entry, ...prev].slice(0, LIVE_CAP),
        );
        if (entry.ok && entry.target && entry.rowKeys?.length) {
          setFlashing((prev) => [
            entry,
            ...prev.filter((p) => p.id !== entry.id),
          ]);
          const t = window.setTimeout(() => {
            setFlashing((prev) => prev.filter((p) => p.id !== entry.id));
            timers.current = timers.current.filter((x) => x !== t);
          }, FLASH_MS);
          timers.current.push(t);
        }
      },
    });
    return () => {
      close();
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
    };
  }, []);

  const value = useMemo<McpStoreValue>(
    () => ({
      server,
      keys,
      tools,
      usage,
      loading,
      refresh,
      async setEnabled(enabled) {
        setServer(await call(getBindings().setMcpEnabled(enabled)));
      },
      async createKey(req) {
        const created = await call(getBindings().createMcpKey(req));
        setKeys((ks) => [...ks, created]);
        return created;
      },
      async updateKey(id, patch) {
        const updated = await call(getBindings().updateMcpKey(id, patch));
        setKeys((ks) => ks.map((k) => (k.id === id ? updated : k)));
        return updated;
      },
      async deleteKey(id) {
        await call(getBindings().deleteMcpKey(id));
        setKeys((ks) => ks.filter((k) => k.id !== id));
      },
      async setLens(keyId, lens) {
        const updated = await call(getBindings().setMcpLens(keyId, lens));
        setKeys((ks) => ks.map((k) => (k.id === keyId ? updated : k)));
      },
      async clearLens(keyId, table) {
        const updated = await call(getBindings().clearMcpLens(keyId, table));
        setKeys((ks) => ks.map((k) => (k.id === keyId ? updated : k)));
      },
    }),
    [server, keys, tools, usage, loading, refresh],
  );

  const activity = useMemo<McpActivityValue>(
    () => ({
      status,
      live,
      latest: live[0] ?? null,
      reads(target) {
        const out = new Set<string>();
        for (const e of flashing) {
          if (e.target !== target) continue;
          for (const k of e.rowKeys ?? []) out.add(k);
        }
        return out;
      },
    }),
    [status, live, flashing],
  );

  return (
    <McpStoreContext.Provider value={value}>
      <McpActivityContext.Provider value={activity}>
        {children}
      </McpActivityContext.Provider>
    </McpStoreContext.Provider>
  );
}
