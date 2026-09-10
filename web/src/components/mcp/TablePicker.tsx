// TablePicker — choose the relations an MCP key may read, by picking them.
//
// This used to be a comma-separated text field, which put the burden of
// remembering exact schema and table spellings on the user and turned every
// typo into a key that silently reached nothing. Here the catalog is the
// source of truth: you search it and tick what you want.
//
// An escape hatch remains for a relation the catalog cannot show — a table
// that does not exist yet, or a key edited while disconnected — so a
// hand-written entry is still possible, still validated, and shown as a chip
// like any other.
import { AlertTriangle, Check, Database, Loader2, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { crawlCatalog, type CatalogTable } from "@/lib/catalog.ts";
import { canonicalTable, tableEntry } from "@/lib/mcp-scope.ts";
import { cn } from "@/lib/utils.ts";

/** Same shape the backend enforces (see backend/mcp.ts). */
const TABLE_RE =
  /^(?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

export function TablePicker({
  value,
  onChange,
  anchorDb,
  /** Only crawl once the dialog holding this is actually open. */
  active,
  id,
}: {
  /** Allowlist entries, as stored: "schema.table" or "db.schema.table". */
  value: string[];
  onChange(next: string[]): void;
  anchorDb: string;
  active: boolean;
  id?: string;
}) {
  const [catalog, setCatalog] = useState<CatalogTable[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [manualError, setManualError] = useState("");
  const crawled = useRef(false);

  useEffect(() => {
    if (!active || crawled.current) return;
    crawled.current = true;
    setLoading(true);
    void crawlCatalog()
      .then(setCatalog)
      .catch(() => setCatalog([]))
      .finally(() => setLoading(false));
  }, [active]);

  // Compare canonically: an entry written "public.users" and a catalog row in
  // the anchor database are the same relation, however each is spelled.
  const chosen = useMemo(
    () => new Set(value.map((t) => canonicalTable(t, anchorDb))),
    [value, anchorDb],
  );

  const matches = useMemo(() => {
    if (!catalog) return [];
    const q = query.trim().toLowerCase();
    const hits = q === ""
      ? catalog
      : catalog.filter((t) =>
        t.search.toLowerCase().includes(q) ||
        t.database.toLowerCase().includes(q)
      );
    return hits.slice(0, 400); // a 40k-relation database must not freeze the dialog
  }, [catalog, query]);

  /** Entries the catalog does not account for — kept, flagged, removable. */
  const unknown = useMemo(() => {
    if (!catalog) return [];
    const known = new Set(
      catalog.map((t) => canonicalTable(qualified(t), anchorDb)),
    );
    return value.filter((t) => !known.has(canonicalTable(t, anchorDb)));
  }, [catalog, value, anchorDb]);

  function toggle(t: CatalogTable): void {
    const entry = tableEntry(t, anchorDb);
    const canon = canonicalTable(entry, anchorDb);
    onChange(
      chosen.has(canon)
        ? value.filter((v) => canonicalTable(v, anchorDb) !== canon)
        : [...value, entry],
    );
  }

  function remove(entry: string): void {
    const canon = canonicalTable(entry, anchorDb);
    onChange(value.filter((v) => canonicalTable(v, anchorDb) !== canon));
  }

  /** Add whatever is in the search box as a literal entry. */
  function addManual(): void {
    const raw = query.trim();
    if (raw === "") return;
    if (!TABLE_RE.test(raw)) {
      setManualError(`"${raw}" is not a schema.table or db.schema.table name`);
      return;
    }
    setManualError("");
    const canon = canonicalTable(raw, anchorDb);
    if (!chosen.has(canon)) onChange([...value, raw]);
    setQuery("");
  }

  // Offer the escape hatch only when the search finds nothing but does look
  // like a relation name — otherwise it is just noise under the box.
  const canAddManual = query.trim() !== "" &&
    matches.length === 0 &&
    !chosen.has(canonicalTable(query.trim(), anchorDb));

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Restrict to tables (optional)</Label>

      {/* What is chosen, up front: the answer to "what will this key see?" */}
      {value.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted">
          Nothing selected — this key reaches{" "}
          <strong className="font-semibold text-foreground">every table</strong>{" "}
          in the connection. Pick tables below to narrow it.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5 rounded-md border border-border bg-raised px-2 py-2">
          {value.map((t) => (
            <Badge
              key={t}
              variant={
                unknown.includes(t) ? "secondary" : "default"
              }
              className="gap-1 pr-1 font-mono"
            >
              {unknown.includes(t) ? (
                <span title="Not in the catalog — it may not exist, or may not be readable">
                  <AlertTriangle className="text-warning-text" />
                </span>
              ) : null}
              {t}
              <button
                type="button"
                onClick={() => remove(t)}
                className="rounded-full p-0.5 hover:bg-background/60"
                aria-label={`Remove ${t}`}
              >
                <X />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
        <Input
          id={id}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (manualError) setManualError("");
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            // Enter takes the single hit, or falls back to a literal add.
            const only = matches.length === 1 ? matches[0] : undefined;
            if (only) toggle(only);
            else addManual();
          }}
          placeholder="Search tables…"
          className="pl-7 font-mono text-xs"
        />
      </div>

      <div className="max-h-[26vh] overflow-y-auto rounded-md border border-border bg-raised">
        {loading ? (
          <p className="flex items-center gap-2 px-3 py-4 text-xs text-muted">
            <Loader2 className="size-3.5 animate-spin" />
            Reading the catalog…
          </p>
        ) : matches.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted">
            {catalog === null || catalog.length === 0
              ? "No catalog available — not connected. Type a name and add it by hand."
              : `No table matches "${query.trim()}".`}
            {canAddManual ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="mt-2 w-full"
                onClick={addManual}
              >
                <Plus />
                Add &ldquo;{query.trim()}&rdquo; anyway
              </Button>
            ) : null}
          </div>
        ) : (
          matches.map((t) => {
            const entry = tableEntry(t, anchorDb);
            const on = chosen.has(canonicalTable(entry, anchorDb));
            return (
              <label
                key={qualified(t)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-surface",
                  on && "bg-accent-soft",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(t)}
                  className="size-3.5 accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                  {t.schema}.{t.table}
                </span>
                {t.database === anchorDb ? null : (
                  <Badge variant="outline" className="gap-1 shrink-0">
                    <Database />
                    {t.database}
                  </Badge>
                )}
                {on ? <Check className="size-3.5 shrink-0 text-accent-text" /> : null}
              </label>
            );
          })
        )}
      </div>

      {manualError ? (
        <p className="text-xs text-danger-text">{manualError}</p>
      ) : (
        <p className="text-xs text-muted">
          {value.length === 0
            ? "Empty means every table. Tables in the anchor database are stored as schema.table; others keep their database prefix."
            : `${value.length} table${value.length === 1 ? "" : "s"} selected.`}
        </p>
      )}
    </div>
  );
}

function qualified(t: CatalogTable): string {
  return `${t.database}.${t.schema}.${t.table}`;
}
