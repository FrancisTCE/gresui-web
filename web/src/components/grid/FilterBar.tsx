// FilterBar — WHERE clause input + row count + pagination controls.
import { Filter, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ColumnInfo } from "../../../../shared/types.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { cn } from "@/lib/utils.ts";

export const PAGE_SIZES = [50, 100, 250, 500];

// Type classifiers — same patterns as InsertRowDialog (not exported there).
const NUM_RE = /^(int|int2|int4|int8|smallint|integer|bigint|numeric|decimal|real|double|float|money|serial|bigserial)/;
const BOOL_RE = /^bool(ean)?$/;
const DATE_RE = /^(date|timestamp|timestamptz)/;

const NUM_OPS = ["=", "!=", "<>", ">", ">=", "<", "<=", "IS NULL", "IS NOT NULL"];
const TEXT_OPS = ["=", "!=", "<>", "LIKE", "ILIKE", "IS NULL", "IS NOT NULL"];
const BOOL_OPS = ["=", "!=", "IS NULL", "IS NOT NULL"];
const DATE_OPS = ["=", "!=", "<>", ">", ">=", "<", "<=", "IS NULL", "IS NOT NULL"];

function opsForType(type: string): string[] {
  if (NUM_RE.test(type)) return NUM_OPS;
  if (BOOL_RE.test(type)) return BOOL_OPS;
  if (DATE_RE.test(type)) return DATE_OPS;
  return TEXT_OPS;
}

interface Suggestions {
  items: string[];
  tokenStart: number;
  meta: string[];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Index after the last ` AND `/` OR ` (case-insensitive) ending at or before caret. */
function tokenStartOf(draft: string, caret: number): number {
  const head = draft.slice(0, caret);
  let last = 0;
  const re = /\s+(?:and|or)\s+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(head)) !== null) last = m.index + m[0].length;
  return last;
}

function computeSuggestions(
  draft: string,
  caret: number,
  columns: ColumnInfo[],
): Suggestions | null {
  if (columns.length === 0) return null;
  const tokenStart = tokenStartOf(draft, caret);
  const token = draft.slice(tokenStart, caret);

  // Branch C — bool literal after "col ="/"col !=".
  for (const col of columns) {
    if (!BOOL_RE.test(col.type)) continue;
    if (new RegExp(`^\\s*${escapeRe(col.name)}\\s*(?:=|!=)\\s*$`).test(token)) {
      // Insert after the "col op" token — replacing it would drop the column.
      return { items: ["true", "false"], tokenStart: caret, meta: ["", ""] };
    }
  }

  // Branch B — exact column name → its type's operators.
  const colMatch = token.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/);
  if (colMatch) {
    const col = columns.find((c) => c.name.toLowerCase() === colMatch[1].toLowerCase());
    if (col) {
      const ops = opsForType(col.type);
      // Insert after the column token — replacing it would drop the column.
      return { items: ops, tokenStart: caret, meta: ops.map(() => "operator") };
    }
  }

  // Branch A — column-name prefix, substring fallback.
  const match = token.trim().toLowerCase();
  let candidates = columns;
  if (match) {
    candidates = columns.filter((c) => c.name.toLowerCase().startsWith(match));
    if (candidates.length === 0) {
      candidates = columns.filter((c) => c.name.toLowerCase().includes(match));
    }
  }
  const sorted = [...candidates].sort((a, b) => a.ordinal - b.ordinal);
  if (sorted.length === 0) return null;
  return {
    items: sorted.map((c) => c.name),
    tokenStart,
    meta: sorted.map((c) => c.type),
  };
}

export function FilterBar({
  filter,
  onApplyFilter,
  total,
  page,
  pageSize,
  onPageSize,
  onPageChange,
  truncated,
  columns,
}: {
  filter: string;
  onApplyFilter(f: string): void;
  total: number;
  page: number;
  pageSize: number;
  onPageSize(s: number): void;
  onPageChange(p: number): void;
  truncated: boolean;
  columns: ColumnInfo[];
}) {
  const [draft, setDraft] = useState(filter);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [focusPos, setFocusPos] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(filter);
    setSuggestions(null);
  }, [filter]);

  // Table switch/refresh: never show suggestions from a previous column set.
  useEffect(() => {
    setSuggestions(null);
  }, [columns]);

  // Restore caret after accepting a suggestion (controlled input resets it).
  useEffect(() => {
    if (focusPos === null) return;
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(focusPos, focusPos);
    }
    setFocusPos(null);
  }, [focusPos]);

  // Click outside the input wrapper closes the list.
  useEffect(() => {
    if (!suggestions) return;
    function onPointerDown(e: PointerEvent): void {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setSuggestions(null);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [suggestions]);

  const updateFromInput = (el: HTMLInputElement) => {
    const caret = el.selectionStart ?? el.value.length;
    setSuggestions(computeSuggestions(el.value, caret, columns));
    setHighlight(0);
  };

  const accept = (item: string) => {
    if (!suggestions) return;
    const el = inputRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? el.value.length;
    const next =
      el.value.slice(0, suggestions.tokenStart) + item + " " + el.value.slice(caret);
    const newCaret = suggestions.tokenStart + item.length + 1;
    setDraft(next);
    setFocusPos(newCaret);
    // Recompute from the accepted text: column → operators, operator → bool literals.
    setSuggestions(computeSuggestions(next, newCaret, columns));
    setHighlight(0);
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-raised p-2">
      <div className="flex items-center gap-2">
        <Filter className="size-4 shrink-0 text-muted" />
        <div className="relative flex-1" ref={wrapperRef}>
          <Input
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              updateFromInput(e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (suggestions) {
                const n = suggestions.items.length;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlight((h) => (h + 1 + n) % n);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlight((h) => (h - 1 + n) % n);
                } else if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  accept(suggestions.items[highlight]);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setSuggestions(null);
                }
              } else if (e.key === "Enter") {
                onApplyFilter(draft);
              } else if (e.key === "Escape") {
                setDraft(filter);
                onApplyFilter("");
              }
            }}
            onSelect={(e) => updateFromInput(e.currentTarget)}
            onClick={(e) => updateFromInput(e.currentTarget)}
            placeholder="WHERE — e.g. status = 'active' AND balance > 100"
            className="h-7 w-full font-mono text-xs"
            aria-label="Filter (WHERE clause)"
          />
          {suggestions ? (
            <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-raised shadow-lg">
              {suggestions.items.map((item, i) => (
                <button
                  key={item}
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-2 py-1 text-left font-mono text-xs hover:bg-surface",
                    i === highlight && "bg-surface",
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => accept(item)}
                >
                  <span>{item}</span>
                  {suggestions.meta[i] && suggestions.meta[i] !== "operator" ? (
                    <span className="text-muted">{suggestions.meta[i]}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <Button size="sm" variant="secondary" onClick={() => onApplyFilter(draft)}>
          Apply
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft("");
            onApplyFilter("");
          }}
          disabled={!filter}
          title="Clear filter"
        >
          <X />
          Clear
        </Button>
        <span className="shrink-0 pl-1 text-xs text-muted">
          {total.toLocaleString()} rows
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className={cn("text-xs", truncated ? "text-danger" : "text-muted")}>
          {truncated
            ? "Showing first 10,000 rows — refine the filter"
            : "Filtered"}
        </span>
        <div className="flex items-center gap-2">
          <Select
            value={String(pageSize)}
            onValueChange={(v) => onPageSize(Number(v))}
          >
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 0}
          >
            Prev
          </Button>
          <span className="text-xs text-muted">
            Page {page + 1} of {pages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pages - 1}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
