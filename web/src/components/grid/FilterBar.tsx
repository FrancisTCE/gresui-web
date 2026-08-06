// FilterBar — WHERE clause input + row count + pagination controls.
import { Filter, X } from "lucide-react";
import { useEffect, useState } from "react";

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

export function FilterBar({
  filter,
  onApplyFilter,
  total,
  page,
  pageSize,
  onPageSize,
  onPageChange,
  truncated,
}: {
  filter: string;
  onApplyFilter(f: string): void;
  total: number;
  page: number;
  pageSize: number;
  onPageSize(s: number): void;
  onPageChange(p: number): void;
  truncated: boolean;
}) {
  const [draft, setDraft] = useState(filter);
  useEffect(() => setDraft(filter), [filter]);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-raised p-2">
      <div className="flex items-center gap-2">
        <Filter className="size-4 shrink-0 text-muted" />
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onApplyFilter(draft);
            else if (e.key === "Escape") {
              setDraft(filter);
              onApplyFilter("");
            }
          }}
          placeholder="WHERE — e.g. status = 'active' AND balance > 100"
          className="h-7 flex-1 font-mono text-xs"
          aria-label="Filter (WHERE clause)"
        />
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
