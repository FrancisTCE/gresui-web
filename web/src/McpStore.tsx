// MCP state, shared by the three places that show it: the top bar badge, the
// MCP Server tab (the whole connection) and the Table MCP tab (one relation).
// They have to agree — a key created from the table tab has to appear in the
// server tab, and revoking one there has to clear the table tab's badge — so
// the fetch and the mutations live here rather than in either panel.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type {
  McpKeyInfo,
  McpServerInfo,
  McpToolInfo,
  McpUsageEntry,
} from "../../shared/types.ts";
import { useAppStore } from "@/AppStore.tsx";
import { call, getBindings } from "@/lib/rpc.ts";

export interface McpStoreValue {
  server: McpServerInfo | null;
  keys: McpKeyInfo[];
  tools: McpToolInfo[];
  /** null until the first load lands. */
  usage: McpUsageEntry[] | null;
  loading: boolean;
  refresh(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  createKey(req: { name: string; scopes: string[]; tables: string[] }): Promise<McpKeyInfo>;
  updateKey(
    id: string,
    patch: { name?: string; scopes?: string[]; tables?: string[] },
  ): Promise<McpKeyInfo>;
  deleteKey(id: string): Promise<void>;
}

const McpStoreContext = createContext<McpStoreValue | null>(null);

export function useMcpStore(): McpStoreValue {
  const v = useContext(McpStoreContext);
  if (!v) throw new Error("useMcpStore must be used inside McpStoreProvider");
  return v;
}

export function McpStoreProvider({ children }: { children: ReactNode }) {
  const { toastStore } = useAppStore();
  const [server, setServer] = useState<McpServerInfo | null>(null);
  const [keys, setKeys] = useState<McpKeyInfo[]>([]);
  const [tools, setTools] = useState<McpToolInfo[]>([]);
  const [usage, setUsage] = useState<McpUsageEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

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
    }),
    [server, keys, tools, usage, loading, refresh],
  );

  return (
    <McpStoreContext.Provider value={value}>{children}</McpStoreContext.Provider>
  );
}
