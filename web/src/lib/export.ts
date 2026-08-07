// Client-side export: pure serializers + the download trigger.
import type { CellValue, Row } from "../../../shared/types.ts";

export type ExportFormat = "csv" | "json";

function csvField(v: CellValue): string {
  if (v === null) return '""';
  const s = typeof v === "string" ? v : String(v);
  return `"${s.replaceAll('"', '""')}"`;
}

/** CSV: UTF-8 BOM, CRLF, header row, every field quoted, quotes doubled. */
export function toCsv(columns: { name: string; type: string }[], rows: Row[]): string {
  const header = columns.map((c) => `"${c.name.replaceAll('"', '""')}"`).join(",");
  return "\uFEFF" + [header, ...rows.map((r) => r.map(csvField).join(","))].join("\r\n") + "\r\n";
}

/** JSON: compact array of column-keyed objects; null stays null. */
export function toJson(columns: { name: string; type: string }[], rows: Row[]): string {
  const objs = rows.map((r) => {
    const o: Record<string, CellValue> = {};
    columns.forEach((c, i) => {
      o[c.name] = r[i] ?? null;
    });
    return o;
  });
  return JSON.stringify(objs);
}

/** Keep filenames sane: anything outside [A-Za-z0-9._-] becomes "_". */
export function sanitizeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_");
}

/** Build the file and trigger a browser download. */
export function downloadExport(
  columns: { name: string; type: string }[],
  rows: Row[],
  format: ExportFormat,
  baseName: string,
): void {
  const content = format === "csv" ? toCsv(columns, rows) : toJson(columns, rows);
  const mime = format === "csv" ? "text/csv;charset=utf-8" : "application/json";
  const name = `${sanitizeFileName(baseName)}.${format}`;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
