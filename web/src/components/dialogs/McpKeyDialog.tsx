// McpKeyDialog — create/edit an MCP API key: name, tool scopes, optional
// "schema.table" allowlist. Create success swaps the body to a one-time view
// of the generated key. The raw value stays recoverable in the UI (Show/Hide
// in the key list) — the frontend is the app's own trust boundary, same as
// connection passwords.
import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { McpKeyInfo, McpToolInfo } from "../../../../shared/types.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { cn } from "@/lib/utils.ts";

const TABLE_RE = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

export function configSnippet(url: string, key: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        gresui: {
          url,
          headers: { Authorization: `Bearer ${key}` },
        },
      },
    },
    null,
    2,
  );
}

export function McpKeyDialog({
  open,
  onOpenChange,
  mode,
  existing,
  tools,
  url,
  onCreate,
  onUpdate,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
  mode: "create" | "edit";
  existing: McpKeyInfo | null;
  tools: McpToolInfo[];
  url: string | null;
  onCreate(req: { name: string; scopes: string[]; tables: string[] }): Promise<McpKeyInfo>;
  onUpdate(id: string, patch: { name?: string; scopes?: string[]; tables?: string[] }): Promise<McpKeyInfo>;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Record<string, boolean>>({});
  const [tablesText, setTablesText] = useState("");
  const [tablesError, setTablesError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<McpKeyInfo | null>(null);
  const [copied, setCopied] = useState<"" | "key" | "config">("");

  const sortedTools = useMemo(
    () => [...tools].sort((a, b) => a.name.localeCompare(b.name)),
    [tools],
  );

  useEffect(() => {
    if (open) {
      setError("");
      setTablesError("");
      setBusy(false);
      setCreated(null);
      setCopied("");
      if (mode === "edit" && existing) {
        setName(existing.name);
        const init: Record<string, boolean> = {};
        for (const t of tools) init[t.name] = existing.scopes.includes(t.name);
        setScopes(init);
        setTablesText(existing.tables.join(", "));
      } else {
        setName("");
        setScopes({});
        setTablesText("");
      }
    }
  }, [open, mode, existing, tools]);

  const scopeCount = Object.values(scopes).filter(Boolean).length;
  const valid = name.trim() !== "" && scopeCount > 0;

  function selectAll(): void {
    const next: Record<string, boolean> = {};
    for (const t of tools) next[t.name] = true;
    setScopes(next);
  }

  function parseTables(): string[] {
    return tablesText
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t !== "");
  }

  function validateTables(): boolean {
    const entries = parseTables();
    for (const t of entries) {
      if (!TABLE_RE.test(t)) {
        setTablesError(`"${t}" is not a valid schema.table`);
        return false;
      }
    }
    setTablesError("");
    return true;
  }

  async function submit(): Promise<void> {
    if (!valid || !validateTables()) return;
    setBusy(true);
    setError("");
    try {
      const req = { name: name.trim(), scopes: sortedTools.filter((t) => scopes[t.name]).map((t) => t.name), tables: parseTables() };
      if (mode === "create") {
        setCreated(await onCreate(req));
      } else if (existing) {
        await onUpdate(existing.id, req);
        onOpenChange(false);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, which: "key" | "config"): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setError("Copy failed — select the text manually");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>API key created</DialogTitle>
              <DialogDescription>
                Copy the key now — it is shown only once.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <code className="block break-all rounded-md border border-border bg-raised px-3 py-2 font-mono text-xs text-foreground">
                {created.key}
              </code>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void copy(created.key, "key")}
                >
                  {copied === "key" ? <Check /> : <Copy />}
                  Copy key
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => url && void copy(configSnippet(url, created.key), "config")}
                  disabled={!url}
                  title={url ? undefined : "Enable the MCP server first"}
                >
                  {copied === "config" ? <Check /> : <Copy />}
                  Copy config JSON
                </Button>
              </div>
              {url ? (
                <p className="text-xs text-muted">
                  Add the config JSON to your MCP client (e.g. Claude Desktop's
                  claude_desktop_config.json) and restart the client.
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{mode === "create" ? "New API key" : `Edit API key "${existing?.name}"`}</DialogTitle>
              <DialogDescription>
                Each key is scoped to a subset of the MCP tools and can be
                restricted to specific tables.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-key-name">Name</Label>
                <Input
                  id="mcp-key-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. claude-desktop"
                />
              </div>

              <fieldset className="space-y-1.5">
                <legend className="mb-1 flex w-full items-center justify-between text-sm font-medium leading-none text-foreground">
                  Tool scopes ({scopeCount}/{sortedTools.length})
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={selectAll}
                    disabled={scopeCount === sortedTools.length}
                  >
                    Select all
                  </Button>
                </legend>
                <div className="grid grid-cols-1 gap-1 rounded-md border border-border bg-raised p-2">
                  {sortedTools.map((t) => (
                    <label
                      key={t.name}
                      className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-surface"
                    >
                      <input
                        type="checkbox"
                        checked={scopes[t.name] ?? false}
                        onChange={(e) =>
                          setScopes((s) => ({ ...s, [t.name]: e.target.checked }))
                        }
                        className="mt-0.5 size-4 accent-[var(--accent)]"
                      />
                      <span className="min-w-0">
                        <span className="block font-mono text-xs font-medium text-foreground">
                          {t.name}
                        </span>
                        <span className="block text-[11px] leading-snug text-muted">
                          {t.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-key-tables">
                  Restrict to tables (optional)
                </Label>
                <Input
                  id="mcp-key-tables"
                  value={tablesText}
                  onChange={(e) => {
                    setTablesText(e.target.value);
                    if (tablesError) setTablesError("");
                  }}
                  onBlur={validateTables}
                  placeholder="public.users, public.orders"
                  className={cn("font-mono text-xs", tablesError && "border-danger")}
                />
                {tablesError ? (
                  <p className="text-xs text-danger">{tablesError}</p>
                ) : (
                  <p className="text-xs text-muted">
                    Comma-separated schema.table names; empty = all tables.
                  </p>
                )}
              </div>
            </div>
            {error ? (
              <div
                role="alert"
                className="rounded-md border border-l-4 border-danger/40 border-l-danger bg-danger/10 px-3 py-2 font-mono text-xs"
              >
                {error}
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={busy || !valid}>
                {busy
                  ? "Saving…"
                  : mode === "create"
                  ? "Create key"
                  : "Save changes"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
