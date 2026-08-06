// Connect screen: saved-connections sidebar + full-width connection form.
import { Database, Eye, EyeOff, Moon, Plug, Plus, Search, Sun, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ConnectionConfig, ConnStatus } from "../../../shared/types.ts";
import { useAppStore } from "@/AppStore.tsx";
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { ErrorBanner } from "@/components/ErrorBanner.tsx";
import { call, getBindings } from "@/lib/rpc.ts";

const SSL_OPTIONS: { value: ConnectionConfig["ssl"]; label: string }[] = [
  { value: "disable", label: "Disable" },
  { value: "require", label: "Require" },
  { value: "verify", label: "Verify full" },
];

function defaults(): Omit<ConnectionConfig, "id"> {
  return {
    name: "",
    host: "127.0.0.1",
    port: 5432,
    user: "postgres",
    password: "",
    database: "",
    ssl: "disable",
  };
}

function ThemeToggle({ theme, setTheme }: { theme: "dark" | "light"; setTheme(t: "dark" | "light"): void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label="Toggle theme"
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

export function ConnectScreen() {
  const { setConnStatus, toastStore, theme, setTheme } = useAppStore();
  const [connections, setConnections] = useState<ConnectionConfig[]>([]);
  const [form, setForm] = useState<Omit<ConnectionConfig, "id">>(defaults());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [portError, setPortError] = useState("");
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ConnectionConfig | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setConnections(await call(getBindings().listConnections()));
      } catch {
        // plain-browser mode: no bindings; show the empty state
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return connections;
    return connections.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.host.toLowerCase().includes(q) ||
      String(c.port).includes(q) ||
      c.database.toLowerCase().includes(q) ||
      c.user.toLowerCase().includes(q)
    );
  }, [connections, search]);

  function selectConnection(c: ConnectionConfig): void {
    setEditingId(c.id);
    setForm({
      name: c.name,
      host: c.host,
      port: c.port,
      user: c.user,
      password: c.password,
      database: c.database,
      ssl: c.ssl,
    });
    setError("");
  }

  function newConnection(): void {
    setEditingId(null);
    setForm(defaults());
    setError("");
  }

  async function removeConnection(id: string): Promise<void> {
    const next = await call(getBindings().deleteConnection(id));
    setConnections(next);
    if (editingId === id) newConnection();
    toastStore.toast({ title: "Connection deleted" });
  }

  function validate(): boolean {
    const port = Number(form.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setPortError("Port must be an integer between 1 and 65535");
      return false;
    }
    setPortError("");
    if (!form.database.trim()) {
      setError("Database name is required");
      return false;
    }
    return true;
  }

  function buildConfig(): ConnectionConfig {
    return {
      id: editingId ?? crypto.randomUUID(),
      name: form.name || `${form.host}:${form.port}`,
      host: form.host.trim() || "127.0.0.1",
      port: Number(form.port),
      user: form.user.trim() || "postgres",
      password: form.password,
      database: form.database.trim(),
      ssl: form.ssl,
    };
  }

  async function saveOnly(): Promise<void> {
    if (!validate()) return;
    setBusy(true);
    setError("");
    try {
      const cfg = buildConfig();
      const next = await call(getBindings().saveConnection(cfg));
      setConnections(next);
      setEditingId(cfg.id);
      toastStore.toast({ title: `Saved "${cfg.name}"` });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doConnect(cfg?: ConnectionConfig): Promise<void> {
    const c = cfg ?? buildConfig();
    if (!cfg && !validate()) return;
    setBusy(true);
    setError("");
    try {
      const status: ConnStatus = await call(getBindings().connect(c));
      await call(
        getBindings().saveConnection({ ...c, lastUsed: new Date().toISOString() }),
      ).catch(() => {});
      setConnections(await call(getBindings().listConnections()).catch(() => connections));
      setConnStatus(status);
      toastStore.toast({
        title: "Connected",
        description: `${status.user}@${status.host}:${status.port}/${status.database}`,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (connections.length === 0 && editingId === null) {
    return (
      <div className="flex h-full flex-col bg-background">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-raised px-3">
          <div className="flex items-center gap-2">
            <Database className="size-5 text-accent" />
            <span className="text-sm font-semibold text-foreground">GRESUI</span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle theme={theme} setTheme={setTheme} />
          </div>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="flex w-full max-w-md flex-col items-center gap-6 p-6">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex size-14 items-center justify-center rounded-xl bg-accent/15">
                <Database className="size-7 text-accent" />
              </div>
              <h1 className="text-2xl font-semibold text-foreground">GRESUI</h1>
              <p className="text-sm text-muted">
                A fast, friendly PostgreSQL client for your desktop.
              </p>
            </div>
            <div className="w-full rounded-lg border border-border bg-raised p-5">
              {formSection()}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-raised px-3">
        <div className="flex items-center gap-2">
          <Database className="size-5 text-accent" />
          <span className="text-sm font-semibold text-foreground">GRESUI</span>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle theme={theme} setTheme={setTheme} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 items-stretch">
        {/* Saved connections sidebar */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-raised">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <span className="text-sm font-semibold text-foreground">Connections</span>
            <Button variant="ghost" size="sm" onClick={newConnection}>
              <Plus />
              New
            </Button>
          </div>
          <div className="border-b border-border px-2 py-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="h-7 pl-7 text-xs"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted">
                {search ? "No matching connections." : "No saved connections yet."}
              </p>
            ) : (
              filtered.map((c) => (
                <ContextMenu key={c.id}>
                  <ContextMenuTrigger>
                    <div
                      className={`group w-full rounded-md border text-left transition-colors ${
                        editingId === c.id
                          ? "border-accent/60 bg-surface"
                          : "border-transparent hover:bg-surface"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => selectConnection(c)}
                        className="w-full px-3 pt-2 text-left"
                      >
                        <div className="truncate text-sm font-medium text-foreground">
                          {c.name}
                        </div>
                        <div className="truncate font-mono text-xs text-muted">
                          {c.user}@{c.host}:{c.port}
                          {c.database ? `/${c.database}` : ""}
                        </div>
                        {c.lastUsed ? (
                          <div className="mt-0.5 text-[11px] text-muted/70">
                            Last used {new Date(c.lastUsed).toLocaleDateString()}
                          </div>
                        ) : null}
                      </button>
                      <div className="flex justify-end gap-1 px-2 pb-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            void doConnect(c);
                          }}
                        >
                          <Plug className="size-3" />
                          Connect
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted hover:text-danger"
                          aria-label={`Delete ${c.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDelete(c);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onClick={() => selectConnection(c)}
                      disabled={editingId === c.id}
                    >
                      Edit
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className="text-danger focus:text-danger"
                      onClick={() => removeConnection(c.id)}
                    >
                      <Trash2 />
                      Delete
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))
            )}
          </div>
        </aside>

        {/* Form — full width */}
        <main className="flex flex-1 overflow-y-auto">
          <div className="flex w-full flex-col p-8">
            <h2 className="mb-6 text-base font-semibold text-foreground">
              {editingId ? "Edit connection" : "New connection"}
            </h2>
            {formSection()}
          </div>
        </main>
      </div>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete connection?</DialogTitle>
            <DialogDescription>
              Remove{" "}
              <span className="font-medium text-foreground">{pendingDelete?.name}</span>{" "}
              from your saved connections?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete) void removeConnection(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  function formSection() {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="conn-name">Connection name</Label>
            <Input
              id="conn-name"
              value={form.name}
              placeholder={`${form.host || "127.0.0.1"}:${form.port}`}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="conn-host">Host</Label>
            <Input
              id="conn-host"
              value={form.host}
              placeholder="127.0.0.1"
              onChange={(e) => setForm({ ...form, host: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="conn-port">Port</Label>
            <Input
              id="conn-port"
              type="number"
              value={form.port}
              min={1}
              max={65535}
              onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
            />
            {portError ? (
              <span className="text-xs text-danger">{portError}</span>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="conn-user">User</Label>
            <Input
              id="conn-user"
              value={form.user}
              placeholder="postgres"
              onChange={(e) => setForm({ ...form, user: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="conn-pass">Password</Label>
            <div className="relative">
              <Input
                id="conn-pass"
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="pr-8"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="conn-db">Database</Label>
            <Input
              id="conn-db"
              value={form.database}
              placeholder="Required — e.g. flared"
              onChange={(e) => setForm({ ...form, database: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>SSL</Label>
            <Select
              value={form.ssl}
              onValueChange={(v) =>
                setForm({ ...form, ssl: v as ConnectionConfig["ssl"] })
              }
            >
              <SelectTrigger id="conn-ssl">
                <SelectValue placeholder="SSL mode" />
              </SelectTrigger>
              <SelectContent>
                {SSL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ErrorBanner message={error} />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={saveOnly} disabled={busy}>
            Save
          </Button>
          <Button onClick={() => void doConnect()} disabled={busy}>
            {busy ? "Connecting…" : "Test & Connect"}
          </Button>
        </div>
      </div>
    );
  }
}
