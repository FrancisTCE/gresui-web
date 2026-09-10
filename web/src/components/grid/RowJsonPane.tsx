// RowJsonPane — bottom panel with pretty-printed JSON for the selected row.
import { ChevronDown, Copy } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils.ts";
import type { CellValue, Row } from "../../../../shared/types.ts";
import type { GridColumn } from "./DataGrid.tsx";

/** Vertical space the grid keeps no matter how tall the pane is asked to be. */
const GRID_RESERVE_PX = 140;

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
  const root = useRef<HTMLDivElement>(null);

  function onPointerDown(e: React.PointerEvent): void {
    e.preventDefault();
    setDrag(true);
    const startY = e.clientY;
    const startH = height;
    // Never let the drag claim the whole column — the grid keeps a strip.
    // Mirrors GRID_RESERVE_PX in the style below so the handle keeps tracking
    // the pointer right up to the cap instead of stopping under it.
    const avail = root.current?.parentElement?.clientHeight ?? 0;
    const max =
      avail > 0 ? Math.max(120, Math.min(600, avail - GRID_RESERVE_PX)) : 600;
    const onMove = (ev: PointerEvent): void => {
      onResize(Math.min(max, Math.max(120, startH + (startY - ev.clientY))));
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
      ref={root}
      // Height is a preference, not a demand: min-h-0 with the default
      // flex-shrink lets the pane give way when the column runs out of room
      // (a short window, or an error banner appearing above it) instead of
      // pushing the status bar off the bottom of the screen.
      className={cn(
        "flex min-h-0 flex-col overflow-hidden border-t border-border bg-raised",
        !open && "h-0 border-t-0",
      )}
      // The cap is what keeps the grid on screen when the column shrinks
      // (a shorter window, an error banner) after the height was chosen: the
      // stored height would otherwise starve a flex-1 sibling down to nothing.
      style={
        open
          ? { height, maxHeight: `calc(100% - ${GRID_RESERVE_PX}px)` }
          : undefined
      }
    >
      {open ? (
        <>
          <div
            className={cn(
              "flex h-1.5 shrink-0 cursor-row-resize items-center justify-center hover:bg-surface-active",
              drag && "bg-surface-active",
            )}
            onPointerDown={onPointerDown}
          >
            <div className="h-0.5 w-10 rounded bg-border" />
          </div>
          <div className="flex shrink-0 items-center justify-between px-3 pb-1.5">
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
                  void navigator.clipboard.writeText(
                    JSON.stringify(obj, null, 2),
                  );
                }}
                className="flex items-center gap-1 text-xs text-muted hover:text-foreground"
                title="Copy JSON"
              >
                <Copy className="size-3.5" />
                Copy
              </button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
            {row ? (
              <pre className="font-mono text-xs leading-relaxed">
                {Object.entries(obj).map(([k, v]) => (
                  <div key={k} className="flex gap-3">
                    <span className="shrink-0 text-muted">{k}</span>
                    <span
                      className={cn(
                        "min-w-0 whitespace-pre-wrap break-words",
                        valueClass(v),
                      )}
                    >
                      {formatValue(v)}
                    </span>
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
  if (v === null) return "italic text-t-null";
  if (typeof v === "boolean") return "text-t-bool";
  if (typeof v === "number") return "text-t-number";
  return "text-foreground";
}

function formatValue(v: CellValue): string {
  if (v === null) return "null";
  if (typeof v === "string") return `"${v}"`;
  return String(v);
}
