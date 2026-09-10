// The empty state the content tabs fall back to when nothing is selected.
//
// It lives here rather than in MainShell because MainShell imports every tab
// and the tabs need this back — a real import cycle, held together only by
// hoisting. One shared component in its own module breaks it.
import { MousePointerSquareDashed, Search, SquareTerminal } from "lucide-react";

import { Kbd } from "@/components/ui/kbd.tsx";
import { modKeyLabel } from "@/lib/platform.ts";

export function NoTableSelected() {
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center animate-slide-up">
        <div className="flex size-12 items-center justify-center rounded-xl bg-accent/10">
          <MousePointerSquareDashed className="size-6 text-accent-text" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            No table selected
          </p>
          <p className="text-sm text-muted">
            Pick a table in the sidebar to browse its rows, or jump straight to
            the SQL editor.
          </p>
        </div>
        <ul className="w-full space-y-2 text-left text-xs text-muted">
          <li className="flex items-center gap-2">
            <Search className="size-3.5 shrink-0 text-subtle" />
            <span>
              Press <Kbd>{modKeyLabel()} K</Kbd> to jump to any table by name.
            </span>
          </li>
          <li className="flex items-center gap-2">
            <SquareTerminal className="size-3.5 shrink-0 text-subtle" />
            <span>
              Open <span className="font-medium text-foreground">SQL</span> and
              run a query with <Kbd>{modKeyLabel()} ↵</Kbd>.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
