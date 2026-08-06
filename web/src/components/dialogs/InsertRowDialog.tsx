// InsertRowDialog — one input per column, type-aware widgets.
import { useEffect, useMemo, useState } from "react";

import type { CellValue, ColumnInfo } from "../../../../shared/types.ts";
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

const JSON_RE = /^(json|jsonb)$/;
const BOOL_RE = /^bool(ean)?$/;
const NUM_RE = /^(int|int2|int4|int8|smallint|integer|bigint|numeric|decimal|real|double|float|money|serial|bigserial)/;
const DATE_RE = /^(date|timestamp|timestamptz)/;

export function InsertRowDialog({
  open,
  onOpenChange,
  columns,
  onInsert,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
  columns: ColumnInfo[];
  onInsert(values: Record<string, CellValue>): Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      const init: Record<string, string | boolean> = {};
      for (const c of columns) {
        init[c.name] = BOOL_RE.test(c.type) ? false : "";
      }
      setValues(init);
      setError("");
      setBusy(false);
    }
  }, [open, columns]);

  const byOrdinal = useMemo(
    () => [...columns].sort((a, b) => a.ordinal - b.ordinal),
    [columns],
  );

  function collect(): Record<string, CellValue> {
    const out: Record<string, CellValue> = {};
    for (const c of byOrdinal) {
      const v = values[c.name];
      if (BOOL_RE.test(c.type)) {
        out[c.name] = v === true;
      } else if (typeof v === "string") {
        if (v.trim() === "") {
          if (!c.notNull && !c.hasDefault) out[c.name] = null;
          // NOT NULL or defaulted: skip — DB fills default / reports error
        } else if (NUM_RE.test(c.type)) {
          out[c.name] = Number(v);
        } else if (JSON_RE.test(c.type)) {
          try {
            out[c.name] = JSON.stringify(JSON.parse(v));
          } catch {
            // keep raw string; DB will surface the parse error
            out[c.name] = v;
          }
        } else {
          out[c.name] = v;
        }
      }
    }
    return out;
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await onInsert(collect());
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New row</DialogTitle>
          <DialogDescription>
            Values for {byOrdinal.length} columns. Empty nullable fields insert
            NULL; empty defaulted fields use the column default.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {byOrdinal.map((c) => (
            <Field
              key={c.name}
              column={c}
              value={values[c.name] ?? ""}
              onChange={(v) => setValues((s) => ({ ...s, [c.name]: v }))}
            />
          ))}
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
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Inserting…" : "Insert row"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  column,
  value,
  onChange,
}: {
  column: ColumnInfo;
  value: string | boolean;
  onChange(v: string | boolean): void;
}) {
  const { name, type, notNull, hasDefault, isPk } = column;
  const bool = BOOL_RE.test(type);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`f-${name}`} className="flex items-center gap-1.5">
        <span className="truncate">{name}</span>
        {isPk ? (
          <span className="rounded bg-accent/20 px-1 text-[10px] text-accent">PK</span>
        ) : null}
        {!notNull ? (
          <span className="text-[10px] font-normal text-muted">nullable</span>
        ) : null}
      </Label>
      {bool ? (
        <input
          id={`f-${name}`}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="size-4 accent-[var(--accent)]"
        />
      ) : (
        <Input
          id={`f-${name}`}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          type={DATE_RE.test(type) ? "datetime-local" : NUM_RE.test(type) ? "number" : "text"}
          placeholder={hasDefault ? "default" : notNull ? "required" : "null"}
          className={cn("font-mono text-xs", JSON_RE.test(type) && "h-16 items-start")}
        />
      )}
      <span className="truncate font-mono text-[10px] text-muted">{type}</span>
    </div>
  );
}
