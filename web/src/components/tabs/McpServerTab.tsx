// MCP Server tab — the connection-wide view: the server itself, every client
// connection (API key) served from it, and usage across all of them.
//
// Deliberately says nothing about the relation the user happens to have open;
// that is the Table MCP tab's job. Two panels that showed the same thing were
// the reason nobody could tell which scope they were looking at.
import {
  AlertCircle,
  Copy,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Table2,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { McpKeyInfo } from "../../../../shared/types.ts";
import { useAppStore } from "@/AppStore.tsx";
import { useMcpStore } from "@/McpStore.tsx";
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
import { ScopeHeader, ServerStateDot } from "@/components/mcp/McpShared.tsx";
import { ActivityFeed, LensSummary } from "@/components/mcp/ActivityFeed.tsx";

const CLAUDE_SNIPPET = (url: string): string => JSON.stringify({
  mcpServers: {
    gresui: {
      url,
      headers: { Authorization: "Bearer <KEY>" },
    },
  },
}, null, 2);

export function McpServerTab({ tabActive }: { tabActive: boolean }) {
  const { connStatus, toastStore } = useAppStore();
  const {
    server: info,
    keys,
    tools,
    usage,
    loading,
    refresh,
    setEnabled,
    createKey,
    updateKey,
    deleteKey,
  } = useMcpStore();
  /** The endpoint, narrowed once: null whenever there is nothing to copy. */
  const url = info?.url ?? null;
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<McpKeyInfo | null>(null);
  const [deleting, setDeleting] = useState<McpKeyInfo | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  // The panel stays mounted while other tabs are shown (MainShell toggles
  // visibility), so re-fetch whenever it is (re)opened.
  useEffect(() => {
    if (tabActive) void refresh();
  }, [tabActive, refresh]);

  async function toggleEnabled(): Promise<void> {
    if (!info) return;
    setBusy(true);
    try {
      await setEnabled(!info.enabled);
      toastStore.toast({
        title: info.enabled ? "MCP server stopped" : "MCP server started",
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
      await deleteKey(deleting.id);
      toastStore.toast({ title: `Connection "${deleting.name}" revoked` });
      setDeleting(null);
    } catch (e) {
      toastStore.toast({
        title: "Failed to revoke connection",
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
  const toolRows = [...toolCounts.entries()].toSorted((a, b) => b[1] - a[1]);
  const keyRows = [...keyCounts.entries()].toSorted((a, b) => b[1] - a[1]);
  const toolMax = toolRows[0]?.[1] ?? 1;
  const keyMax = keyRows[0]?.[1] ?? 1;
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = usage?.filter((e) => e.ts.slice(0, 10) === today).length ?? 0;

  return (
    <div className="h-full overflow-y-auto bg-background p-4">
      <ScopeHeader
        icon={Server}
        title="MCP Server"
        subtitle="Connection-wide: the server and every client connected to it."
        scope={
          <Badge variant="secondary" className="font-mono">
            {connStatus.database ?? "not connected"}
          </Badge>
        }
        actions={
          // Usage arrives from MCP clients, not from anything the user does
          // here, so this panel needs a way to catch up without a tab dance.
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refresh()}
            disabled={loading}
            title="Reload keys and usage"
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
        }
      />

      {!connStatus.connected ? (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-l-4 border-danger/40 border-l-danger bg-danger/10 px-3 py-2 text-sm text-foreground"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger-text" />
          <span className="min-w-0 break-words font-mono text-xs leading-relaxed">
            MCP tools need an active connection — connect to a database first.
          </span>
        </div>
      ) : null}

      {/* Server card */}
      <div className="mb-6 rounded-md border border-border bg-raised p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <ServerStateDot enabled={info?.enabled ?? false} />
            <span className="text-sm font-semibold text-foreground">
              {info?.enabled ? "Serving" : "Stopped"}
            </span>
            {info?.enabled && url !== null ? (
              <code className="truncate rounded bg-surface px-2 py-1 font-mono text-xs text-muted">
                {url}
              </code>
            ) : null}
          </div>
          <Button
            variant={info?.enabled ? "secondary" : "default"}
            onClick={() => void toggleEnabled()}
            disabled={busy || !info}
          >
            {info?.enabled ? "Stop server" : "Start server"}
          </Button>
        </div>

        {info?.enabled && url !== null ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted">Endpoint:</span>
              <code className="rounded bg-surface px-2 py-1 font-mono text-xs text-foreground">
                {url}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void copy(url, "Endpoint URL")}
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
                {CLAUDE_SNIPPET(url)}
              </pre>
            </div>

            <p className="text-xs text-muted">
              Port 3939 falls back to a random port if taken — the URL above is
              authoritative.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Start the server to expose the connected database to MCP clients on
            this machine.
          </p>
        )}
      </div>

      {/* Connections (API keys) */}
      <div className="mb-3 flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            Connections ({keys.length})
          </h2>
          <p className="text-xs text-muted">
            One API key per client. Each carries its own tool scopes and table
            reach.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus />
          New connection
        </Button>
      </div>
      {keys.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted">
          No connections yet — create one to connect an MCP client.
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
                      url !== null &&
                      void copy(configSnippet(url, k.key), "Config")
                    }
                    disabled={url === null}
                    title={url !== null ? "Copy client config with this key" : "Start the MCP server first"}
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
                    aria-label={`Revoke ${k.name}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              {/* Reach first: what this connection can read matters more at a
                  glance than which tools it may call. */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {k.tables.length === 0 ? (
                  <Badge variant="default" className="gap-1">
                    <Table2 />
                    All tables
                  </Badge>
                ) : (
                  <>
                    <Badge variant="secondary" className="gap-1">
                      <Table2 />
                      {k.tables.length} table{k.tables.length === 1 ? "" : "s"}
                    </Badge>
                    {k.tables.map((t) => (
                      <Badge key={t} variant="outline" className="font-mono">
                        {t}
                      </Badge>
                    ))}
                  </>
                )}
              </div>
              {k.lenses.length > 0 ? (
                <div className="mt-1.5 space-y-1 rounded-md border border-border bg-background px-2 py-1.5">
                  {k.lenses.map((l) => (
                    <div
                      key={l.table}
                      className="flex flex-wrap items-center gap-2 text-[11px]"
                    >
                      <EyeOff className="size-3 shrink-0 text-warning-text" />
                      <code className="font-mono text-foreground">{l.table}</code>
                      <LensSummary
                        hidden={l.hiddenColumns}
                        filter={l.rowFilter}
                      />
                    </div>
                  ))}
                  <p className="text-[11px] text-subtle">
                    Lenses are per relation — edit one from that table&rsquo;s
                    Table MCP tab.
                  </p>
                </div>
              ) : null}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {k.scopes.toSorted().map((s) => (
                  <Badge key={s} variant="muted" className="font-mono">
                    {s}
                  </Badge>
                ))}
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

      {/* What is happening right now, across every key on this connection. */}
      <div className="mb-5 mt-6">
        <ActivityFeed />
      </div>

      {/* Analytics + usage history */}
      <div className="mb-5">
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
                <p className="text-xs text-muted">Connections</p>
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
              By connection
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
                    <th className="px-3 py-1.5 font-medium">Connection</th>
                    <th className="px-3 py-1.5 font-medium">Tool</th>
                    <th className="px-3 py-1.5 font-medium">Result</th>
                    <th className="px-3 py-1.5 font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((e) => (
                    <tr key={e.id} className="border-t border-border/60">
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
                          <span className="text-accent-text">ok</span>
                        ) : (
                          <span className="text-danger-text">error</span>
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
        url={url}
        onCreate={createKey}
        onUpdate={updateKey}
      />

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Revoke connection?</DialogTitle>
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
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
