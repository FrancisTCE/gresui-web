// Table MCP tab — MCP access for the open relation, and nothing else.
//
// The question this answers is "can an MCP client read *this* table, and
// through which connection?". A connection can reach it two ways: because it
// names the table (explicit), or because it has no allowlist at all and so
// reaches every table (inherited from the connection-wide key). The two are
// labelled differently on purpose — the inherited ones cannot be edited from
// here, since narrowing them would change every other table too.
import {
  ArrowUpRight,
  Check,
  EyeOff,
  Minus,
  Plug,
  Plus,
  RefreshCw,
  ShieldOff,
  Table2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "@/AppStore.tsx";
import { McpKeyDialog } from "@/components/dialogs/McpKeyDialog.tsx";
import { ActivityFeed, LensSummary } from "@/components/mcp/ActivityFeed.tsx";
import { LensDialog } from "@/components/mcp/LensDialog.tsx";
import { ScopeHeader, ServerStateDot } from "@/components/mcp/McpShared.tsx";
import { NoTableSelected } from "@/components/NoTableSelected.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  type Coverage,
  keyCoverage,
  lensFor,
  qualifiedTable,
  tableEntry,
  withoutTable,
  withTable,
} from "@/lib/mcp-scope.ts";
import { cn } from "@/lib/utils.ts";
import { useMcpStore } from "@/McpStore.tsx";
import type { McpKeyInfo, McpLens } from "../../../../shared/types.ts";

export function TableMcpTab({
  tabActive,
  onOpenServer,
}: {
  tabActive: boolean;
  onOpenServer(): void;
}) {
  const { active, connStatus, toastStore } = useAppStore();
  const {
    server,
    keys,
    tools,
    loading,
    refresh,
    setEnabled,
    createKey,
    updateKey,
    deleteKey,
    setLens,
    clearLens,
  } = useMcpStore();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  /** Set when unexposing would empty a key's allowlist — an empty allowlist
   * means "all tables", so the safe answer is to revoke the key instead. */
  const [lastTable, setLastTable] = useState<McpKeyInfo | null>(null);
  /** The key whose lens on this table is being edited. */
  const [lensKey, setLensKey] = useState<McpKeyInfo | null>(null);

  useEffect(() => {
    if (tabActive) void refresh();
  }, [tabActive, refresh]);

  if (!active) return <NoTableSelected />;
  // The guard above narrows `active` for the JSX, but not for the hoisted
  // function declarations below; a const carries the narrowing to them.
  const target = active;

  const anchorDb = connStatus.database ?? active.database;
  const label = `${active.schema}.${active.table}`;
  const entry = tableEntry(active, anchorDb);

  const scored = keys.map((k) => ({
    key: k,
    coverage: keyCoverage(k, active, anchorDb),
    lens: lensFor(k, active, anchorDb),
  }));
  const exposed = scored.filter((s) => s.coverage !== null);
  const others = scored.filter((s) => s.coverage === null);
  const explicitCount = exposed.filter((s) => s.coverage === "explicit").length;
  const inheritedCount = exposed.length - explicitCount;
  const serverOn = server?.enabled ?? false;
  const live = serverOn && exposed.length > 0;
  const lensedCount = exposed.filter((s2) => s2.lens !== null).length;
  /** Canonical name the activity feed and the grid both key rows by. */
  const targetRef = qualifiedTable(active);

  async function expose(k: McpKeyInfo): Promise<void> {
    setBusyKey(k.id);
    try {
      await updateKey(k.id, { tables: withTable(k, target, anchorDb) });
      toastStore.toast({ title: `${label} exposed to "${k.name}"` });
    } catch (e) {
      toastStore.toast({
        title: "Failed to update connection",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function unexpose(k: McpKeyInfo): Promise<void> {
    const next = withoutTable(k, target, anchorDb);
    if (next.length === 0) {
      setLastTable(k); // would widen the key to every table — ask first
      return;
    }
    setBusyKey(k.id);
    try {
      await updateKey(k.id, { tables: next });
      toastStore.toast({ title: `${label} removed from "${k.name}"` });
    } catch (e) {
      toastStore.toast({
        title: "Failed to update connection",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function revokeLastTable(): Promise<void> {
    if (!lastTable) return;
    setBusyKey(lastTable.id);
    try {
      await deleteKey(lastTable.id);
      toastStore.toast({ title: `Connection "${lastTable.name}" revoked` });
      setLastTable(null);
    } catch (e) {
      toastStore.toast({
        title: "Failed to revoke connection",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-background p-4">
      <ScopeHeader
        icon={Plug}
        title="Table MCP"
        subtitle="MCP access for this relation only. The server itself and its other tables live in MCP Server."
        scope={
          <Badge variant="solid" className="gap-1 font-mono">
            <Table2 />
            {label}
          </Badge>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void refresh()}
              disabled={loading}
              title="Reload connections"
            >
              <RefreshCw className={loading ? "animate-spin" : ""} />
            </Button>
            <Button size="sm" variant="secondary" onClick={onOpenServer}>
              MCP Server
              <ArrowUpRight />
            </Button>
          </>
        }
      />

      {/* Verdict strip — the one line the user came for. */}
      <div
        className={cn(
          "mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2.5",
          live ? "border-accent/40 bg-accent/10" : "border-border bg-raised",
        )}
      >
        <ServerStateDot enabled={live} />
        <span className="text-sm font-medium text-foreground">
          {!serverOn
            ? "Server stopped — nothing is served, including this table."
            : exposed.length === 0
              ? "Not exposed — no MCP client can read this table."
              : `Exposed through ${exposed.length} connection${exposed.length === 1 ? "" : "s"}.`}
        </span>
        {serverOn && exposed.length > 0 ? (
          <span className="flex items-center gap-1.5">
            {explicitCount > 0 ? (
              <Badge variant="default">
                {explicitCount} scoped to this table
              </Badge>
            ) : null}
            {inheritedCount > 0 ? (
              <Badge variant="outline">
                {inheritedCount} via all-tables key
              </Badge>
            ) : null}
            {lensedCount > 0 ? (
              <Badge variant="secondary" className="gap-1">
                <EyeOff />
                {lensedCount} through a lens
              </Badge>
            ) : null}
          </span>
        ) : null}
        {!serverOn ? (
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            disabled={!server}
            onClick={() => {
              void setEnabled(true).catch((e: Error) =>
                toastStore.toast({
                  title: "Failed to start MCP server",
                  description: e.message,
                  variant: "destructive",
                }),
              );
            }}
          >
            Start server
          </Button>
        ) : null}
      </div>

      {/* Exposed through */}
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Exposed through
        </h3>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus />
          New connection for this table
        </Button>
      </div>
      {exposed.length === 0 ? (
        <p className="mb-6 flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted">
          <ShieldOff className="size-4 shrink-0" />
          <span className="flex-1 text-left">
            No connection reaches{" "}
            <code className="font-mono text-foreground">{label}</code>. Expose
            it to one below, or create a connection scoped to just this table.
          </span>
        </p>
      ) : (
        <div className="mb-6 space-y-2">
          {exposed.map(({ key: k, coverage, lens }) => (
            <KeyRow
              key={k.id}
              k={k}
              coverage={coverage}
              lens={lens}
              busy={busyKey === k.id}
              onOpenServer={onOpenServer}
              onToggle={() => void unexpose(k)}
              onEditLens={() => setLensKey(k)}
            />
          ))}
        </div>
      )}

      {/* Everything else */}
      {others.length > 0 ? (
        <>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Other connections ({others.length})
          </h3>
          <div className="space-y-2">
            {others.map(({ key: k, coverage, lens }) => (
              <KeyRow
                key={k.id}
                k={k}
                coverage={coverage}
                lens={lens}
                busy={busyKey === k.id}
                onOpenServer={onOpenServer}
                onToggle={() => void expose(k)}
              />
            ))}
          </div>
        </>
      ) : null}

      <div className="mt-6">
        <ActivityFeed target={targetRef} />
      </div>

      {lensKey ? (
        <LensDialog
          open
          onOpenChange={(o) => !o && setLensKey(null)}
          keyInfo={lensKey}
          tableRef={entry}
          database={active.database}
          schema={active.schema}
          table={active.table}
          existing={lensFor(lensKey, active, anchorDb)}
          onSave={(lens) => setLens(lensKey.id, lens)}
          onClear={() => clearLens(lensKey.id, entry)}
        />
      ) : null}

      <McpKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        existing={null}
        tools={tools}
        url={server?.url ?? null}
        defaultTables={[entry]}
        onCreate={createKey}
        onUpdate={updateKey}
      />

      <Dialog
        open={lastTable !== null}
        onOpenChange={(o) => !o && setLastTable(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>That would widen the connection</DialogTitle>
            <DialogDescription>
              <code className="font-mono">{label}</code> is the only table
              &ldquo;{lastTable?.name}&rdquo; is allowed to read. A connection
              with an empty table list reaches <em>every</em> table, so removing
              it here would grant more access, not less. Revoke the connection
              instead?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setLastTable(null)}
              disabled={busyKey !== null}
            >
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => void revokeLastTable()}
              disabled={busyKey !== null}
            >
              Revoke connection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KeyRow({
  k,
  coverage,
  lens,
  busy,
  onToggle,
  onOpenServer,
  onEditLens,
}: {
  k: McpKeyInfo;
  coverage: Coverage;
  lens: McpLens | null;
  busy: boolean;
  onToggle(): void;
  onOpenServer(): void;
  /** Absent for keys that do not reach this table — there is nothing to lens. */
  onEditLens?: (() => void) | undefined;
}) {
  const inherited = coverage === "all";
  return (
    <div
      className={cn(
        "rounded-md border bg-raised p-3",
        coverage === "explicit" ? "border-accent/40" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {k.name}
          </span>
          {coverage === "explicit" ? (
            <Badge variant="default" className="gap-1">
              <Check />
              Scoped to this table
            </Badge>
          ) : inherited ? (
            <Badge variant="outline" className="gap-1">
              <Table2 />
              All tables
            </Badge>
          ) : (
            <Badge variant="muted">
              {k.tables.length} other table{k.tables.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
        {inherited ? (
          // Narrowing an all-tables key from here would silently change every
          // other relation — send the user where that decision belongs.
          <Button size="sm" variant="ghost" onClick={onOpenServer}>
            Manage in MCP Server
            <ArrowUpRight />
          </Button>
        ) : (
          <Button
            size="sm"
            variant={coverage === "explicit" ? "ghost" : "secondary"}
            onClick={onToggle}
            disabled={busy}
          >
            {coverage === "explicit" ? <Minus /> : <Plus />}
            {coverage === "explicit" ? "Remove" : "Expose here"}
          </Button>
        )}
      </div>
      {onEditLens ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Lens
          </span>
          <span className="min-w-0 text-[11px]">
            {lens ? (
              <LensSummary
                hidden={lens.hiddenColumns}
                filter={lens.rowFilter}
              />
            ) : (
              <span className="text-muted">
                whole row — every column, every row
              </span>
            )}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={onEditLens}
            disabled={busy}
          >
            <EyeOff />
            {lens ? "Edit lens" : "Add lens"}
          </Button>
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {k.scopes
          .toSorted((a, b) => a.localeCompare(b))
          .map((s) => (
            <Badge key={s} variant="muted" className="font-mono">
              {s}
            </Badge>
          ))}
        <span className="ml-auto text-[11px] text-muted">
          {inherited
            ? "connection-wide key"
            : k.lastUsedAt
              ? `last used ${new Date(k.lastUsedAt).toLocaleString()}`
              : "never used"}
        </span>
      </div>
    </div>
  );
}
