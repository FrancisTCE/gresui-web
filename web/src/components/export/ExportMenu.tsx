import { Download } from "lucide-react";
import type { ExportFormat } from "@/lib/export.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";

export function ExportMenu({
  onExport,
  disabled = false,
  exporting = false,
}: {
  onExport(format: ExportFormat): void;
  disabled?: boolean;
  exporting?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="secondary" disabled={disabled}>
          <Download className={exporting ? "animate-pulse" : ""} />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onExport("csv")}>Export CSV</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onExport("json")}>Export JSON</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
