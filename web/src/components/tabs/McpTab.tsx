// MCP tab: server toggle, endpoint + client snippet, API key management.
// Reachable only while connected (MainShell); tools need a live session.
import { AlertCircle, Copy, Eye, EyeOff, Pencil, Plug, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type {
  McpKeyInfo,
  McpServerInfo,
  McpToolInfo,
  McpUsageEntry,
} from "../../../../shared/types.ts";
import { useAppStore } from "@/AppStore.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { McpKeyDialog, configSnippet } from "@/components/dialogs/McpKeyDialog.tsx";
import { call, getBindings } from "@/lib/rpc.ts";

const CLAUDE_SNIPPET = (url: string): string => JSON.stringify({
  mcpServers: {
    gresui: {
      url,
      headers: { Authorization: "Bearer <KEY>" },
    },
  },
}, null, 2);

export function McpTab({ tabActive }: { tabActive: boolean }) {
  const { connStatus, toastStore, active } = useAppStore();
  const [info, setInfo] = useState<McpServerInfo | null>(null);
  const [keys, setKeys] = useState<McpKeyInfo[]>([]);
  const [tools, setTools] = useState<McpToolInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<McpKeyInfo | null>(null);
  const [deleting, setDeleting] = useState<McpKeyInfo | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [createDefaultTables, setCreateDefaultTables] = useState<string[]>([]);
  const [usage, setUsage] = useState<McpUsageEntry[] | null>(null);

  const load = useCallback(async () => {
    const b = getBindings();
    try {
      const [i, ks, ts, u] = await Promise.all([
        call(b.getMcpServerInfo()),
        call(b.listMcpKeys()),
        call(b.listMcpTools()),
        call(b.listMcpUsage()),
      ]);
      setInfo(i);
      setKeys(ks);
      setTools(ts);
      setUsage(u);
    } catch (e) {
      toastStore.toast({
        title: "Failed to load MCP settings",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  }, [toastStore]);

  useEffect(() => {
    void load();
  }, [load]);

  // The panel stays mounted while other tabs are shown (MainShell toggles
  // visibility), so re-fetch whenever the MCP tab is (re)opened.
  useEffect(() => {
    if (tabActive) void load();
  }, [tabActive, load]);

  async function toggleEnabled(): Promise<void> {
    if (!info) return;
    setBusy(true);
    try {
      const next = await call(getBindings().setMcpEnabled(!info.enabled));
      setInfo(next);
      toastStore.toast({
        title: next.enabled ? "MCP enabled" : "MCP disabled",
        description: next.url ?? undefined,
      });
    } catch (e) {
      toastStore.toast({
        title: "Failed to toggle MCP server",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toastStore.toast({ title: `${label} copied` });
    } catch {
      toastStore.toast({
        title: "Copy failed",
        description: "Select the text manually",
        variant: "destructive",
      });
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    setBusy(true);
    try {
      await call(getBindings().deleteMcpKey(deleting.id));
      toastStore.toast({ title: `API key "${deleting.name}" deleted` });
      setDeleting(null);
      setKeys((ks) => ks.filter((k) => k.id !== deleting.id));
    } catch (e) {
      toastStore.toast({
        title: "Failed to delete API key",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  // Dashboard breakdowns (count desc); key rows label deleted keys.
  const toolCounts = new Map<string, number>();
  const keyCounts = new Map<string, number>();
  for (const e of usage ?? []) {
    toolCounts.set(e.tool, (toolCounts.get(e.tool) ?? 0) + 1);
    const label = e.keyName ?? "deleted key";
    keyCounts.set(label, (keyCounts.get(label) ?? 0) + 1);
  }
  const toolRows = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]);
  const keyRows = [...keyCounts.entries()].sort((a, b) => b[1] - a[1]);
  const toolMax = toolRows[0]?.[1] ?? 1;
  const keyMax = keyRows[0]?.[1] ?? 1;
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = usage?.filter((e) => e.ts.slice(0, 10) === today).length ?? 0;

  return (
    <div className="h-full overflow-y-auto bg-background p-4">
      {!connStatus.connected ? (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-l-4 border-danger/40 border-l-danger bg-danger/10 px-3 py-2 text-sm text-foreground"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />
          <span className="min-w-0 break-words font-mono text-xs leading-relaxed">
            MCP tools need an active connection — connect to a database first.
          </span>
        </div>
      ) : null}

      {/* Server card */}
      <div className="mb-5 rounded-md border border-border bg-raised p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Plug className="size-4 text-accent" />
            MCP Server
          </h2>
          <Button
            variant={info?.enabled ? "secondary" : "default"}
            onClick={() => void toggleEnabled()}
            disabled={busy || !info}
          >
            {info?.enabled ? "Disable" : "Enable"}
          </Button>
        </div>

        {info?.enabled && info.url ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted">Endpoint:</span>
              <code className="rounded bg-surface px-2 py-1 font-mono text-xs text-foreground">
                {info.url}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void copy(info.url!, "Endpoint URL")}
              >
                <Copy />
                Copy
              </Button>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-muted">
                Claude Desktop config (replace <code className="font-mono">&lt;KEY&gt;</code>):
              </p>
              <pre className="overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground">
                {CLAUDE_SNIPPET(info.url)}
              </pre>
            </div>

            <p className="text-xs text-muted">
              Port 3939 falls back to a random port if taken — the URL above is
              authoritative.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Enable the server to expose the connected database to MCP clients
            on this machine.
          </p>
        )}
      </div>

      {/* Keys */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            API Keys ({keys.length})
          </h2>
          {active?.table ? (
            <Badge variant="secondary" className="font-mono text-[11px]">
              scoped to {active.database}.{active.schema}.{active.table}
            </Badge>
          ) : null}
        </div>
        <Button
          size="sm"
          onClick={() => {
            const t = active && active.table ? `${active.database}.${active.schema}.${active.table}` : null;
            setCreateDefaultTables(t ? [t] : []);
            setCreateOpen(true);
          }}
        >
          <Plus />
          New Key
        </Button>
      </div>
      {keys.length === 0 ? (
        <p className="text-sm text-muted">
          No API keys yet — create one to connect an MCP client.
        </p>
      ) : (
        <div className="space-y-2">
          {keys.map((k) => (
            <div
              key={k.id}
              className="rounded-md border border-border bg-raised p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {k.name}
                  </span>
                  <code className="truncate font-mono text-xs text-muted">
                    {revealed[k.id] ? k.key : `${k.key.slice(0, 14)}…`}
                  </code>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setRevealed((r) => ({ ...r, [k.id]: !r[k.id] }))
                    }
                    aria-label={revealed[k.id] ? "Hide key" : "Show key"}
                  >
                    {revealed[k.id] ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      info && info.url &&
                      void copy(configSnippet(info.url, k.key), "Config")
                    }
                    disabled={!info?.url}
                    title={info?.url ? "Copy client config with this key" : "Enable the MCP server first"}
                  >
                    <Copy />
                    Copy config
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(k)}
                    aria-label={`Edit ${k.name}`}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleting(k)}
                    aria-label={`Delete ${k.name}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {[...k.scopes].sort().map((s) => (
                  <Badge key={s} variant="secondary" className="font-mono text-[11px]">
                    {s}
                  </Badge>
                ))}
                {k.tables.length > 0
                  ? k.tables.map((t) => (
                      <Badge key={t} variant="outline" className="font-mono text-[11px]">
                        {t}
                      </Badge>
                    ))
                  : <span className="text-[11px] text-muted">all tables</span>}
                <span className="ml-auto text-[11px] text-muted">
                  created {new Date(k.createdAt).toLocaleString()}
                  {k.lastUsedAt
                    ? ` · last used ${new Date(k.lastUsedAt).toLocaleString()}`
                    : " · never used"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Analytics + usage history */}
      <div className="mb-5 mt-6">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Analytics
        </h2>
        {usage === null ? (
          <Skeleton className="h-24 w-full" />
        ) : usage.length === 0 ? (
          <p className="text-sm text-muted">
            No MCP usage yet — connect a client and call a tool.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-md border border-border bg-raised p-3">
                <p className="text-xs text-muted">Total requests</p>
                <p className="text-lg font-semibold text-foreground">
                  {usage.length}
                </p>
              </div>
              <div className="rounded-md border border-border bg-raised p-3">
                <p className="text-xs text-muted">Requests today</p>
                <p className="text-lg font-semibold text-foreground">
                  {todayCount}
                </p>
              </div>
              <div className="rounded-md border border-border bg-raised p-3">
                <p className="text-xs text-muted">Tools used</p>
                <p className="text-lg font-semibold text-foreground">
                  {new Set(usage.map((e) => e.tool)).size}
                </p>
              </div>
              <div className="rounded-md border border-border bg-raised p-3">
                <p className="text-xs text-muted">API keys</p>
                <p className="text-lg font-semibold text-foreground">
                  {keys.length}
                </p>
              </div>
            </div>

            <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
              By tool
            </h3>
            <div className="space-y-1.5">
              {toolRows.map(([tool, count]) => (
                <div key={tool} className="flex items-center gap-2">
                  <span className="w-44 truncate font-mono text-xs text-foreground">
                    {tool}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded bg-surface">
                    <div
                      className="h-full rounded bg-accent"
                      style={{ width: `${(count / toolMax) * 100}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-xs text-muted">
                    {count}
                  </span>
                </div>
              ))}
            </div>

            <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
              By key
            </h3>
            <div className="space-y-1.5">
              {keyRows.map(([label, count]) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-44 truncate font-mono text-xs text-foreground">
                    {label}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded bg-surface">
                    <div
                      className="h-full rounded bg-accent"
                      style={{ width: `${(count / keyMax) * 100}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-xs text-muted">
                    {count}
                  </span>
                </div>
              ))}
            </div>

            <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
              Recent requests
            </h3>
            <div className="mb-5 overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-raised text-left text-xs text-muted">
                    <th className="px-3 py-1.5 font-medium">Time</th>
                    <th className="px-3 py-1.5 font-medium">Key</th>
                    <th className="px-3 py-1.5 font-medium">Tool</th>
                    <th className="px-3 py-1.5 font-medium">Result</th>
                    <th className="px-3 py-1.5 font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((e, i) => (
                    <tr key={`${e.ts}-${i}`} className="border-t border-border/60">
                      <td className="px-3 py-1.5 text-muted">
                        {new Date(e.ts).toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">
                        {e.keyName ?? "deleted key"}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">
                        {e.tool}
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        {e.ok ? (
                          <span className="text-accent">ok</span>
                        ) : (
                          <span className="text-danger">error</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-muted">
                        {e.durationMs} ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <McpKeyDialog
        open={createOpen || editing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setCreateOpen(false);
            setEditing(null);
          }
        }}
        mode={editing ? "edit" : "create"}
        existing={editing}
        tools={tools}
        url={info?.url ?? null}
        defaultTables={createDefaultTables}
        onCreate={async (req) => {
          const created = await call(getBindings().createMcpKey(req));
          setKeys((ks) => [...ks, created]);
          return created;
        }}
        onUpdate={async (id, patch) => {
          const updated = await call(getBindings().updateMcpKey(id, patch));
          setKeys((ks) => ks.map((k) => (k.id === id ? updated : k)));
          return updated;
        }}
      />

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete API key?</DialogTitle>
            <DialogDescription>
              Delete API key &ldquo;{deleting?.name}&rdquo;? Clients using it
              will lose access immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={busy}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
