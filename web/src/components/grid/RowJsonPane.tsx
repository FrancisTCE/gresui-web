// RowJsonPane — bottom panel with pretty-printed JSON for the selected row.
import { ChevronDown, Copy } from "lucide-react";
import { useState } from "react";

import type { CellValue, Row } from "../../../../shared/types.ts";
import type { GridColumn } from "./DataGrid.tsx";
import { cn } from "@/lib/utils.ts";

export function RowJsonPane({
  open,
  onToggle,
  height,
  onResize,
  columns,
  row,
}: {
  open: boolean;
  onToggle(): void;
  height: number;
  onResize(h: number): void;
  columns: GridColumn[];
  row: Row | null;
}) {
  const [drag, setDrag] = useState(false);

  function onPointerDown(e: React.PointerEvent): void {
    e.preventDefault();
    setDrag(true);
    const startY = e.clientY;
    const startH = height;
    const onMove = (ev: PointerEvent): void => {
      onResize(Math.min(600, Math.max(120, startH + (startY - ev.clientY))));
    };
    const onUp = (): void => {
      setDrag(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const obj: Record<string, CellValue> = {};
  if (row) {
    columns.forEach((c, i) => {
      obj[c.name] = row[i] ?? null;
    });
  }

  return (
    <div
      className={cn(
        "shrink-0 border-t border-border bg-raised",
        !open && "h-0 overflow-hidden border-t-0",
      )}
      style={open ? { height } : undefined}
    >
      {open ? (
        <>
          <div
            className={cn(
              "flex h-1.5 cursor-row-resize items-center justify-center hover:bg-surface-active",
              drag && "bg-surface-active",
            )}
            onPointerDown={onPointerDown}
          >
            <div className="h-0.5 w-10 rounded bg-border" />
          </div>
          <div className="flex items-center justify-between px-3 pb-1.5">
            <button
              type="button"
              onClick={onToggle}
              className="flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground"
            >
              <ChevronDown className="size-3.5" />
              Row JSON
            </button>
            {row ? (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
                }}
                className="flex items-center gap-1 text-xs text-muted hover:text-foreground"
                title="Copy JSON"
              >
                <Copy className="size-3.5" />
                Copy
              </button>
            ) : null}
          </div>
          <div className="overflow-auto px-3 pb-3">
            {row ? (
              <pre className="font-mono text-xs leading-relaxed">
                {Object.entries(obj).map(([k, v]) => (
                  <div key={k} className="flex gap-3">
                    <span className="shrink-0 text-accent">&quot;{k}&quot;:</span>
                    <span className={valueClass(v)}>{formatValue(v)}</span>
                  </div>
                ))}
              </pre>
            ) : (
              <p className="text-xs text-muted">
                Click a row to inspect its values.
              </p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function valueClass(v: CellValue): string {
  if (v === null) return "italic text-muted";
  if (typeof v === "boolean") return "text-accent";
  if (typeof v === "number") return "text-accent";
  return "text-foreground";
}

function formatValue(v: CellValue): string {
  if (v === null) return "null";
  if (typeof v === "string") return `"${v}"`;
  return String(v);
}
