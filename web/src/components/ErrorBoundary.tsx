// ErrorBoundary — React 19 unmounts the whole tree on an uncaught render
// error, leaving a blank window. This catches it, shows the message, and
// forwards the details to the backend log file.
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button.tsx";
import { call, getBindings } from "@/lib/rpc.ts";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const detail =
      `${error.message}\n${error.stack ?? ""}\n${info.componentStack ?? ""}`;
    try {
      call(getBindings().logError(`[boundary] ${detail}`)).catch(() => {});
    } catch {
      // plain-browser mode: no bindings
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background p-8 text-center">
        <AlertTriangle className="size-10 text-danger" />
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Something went wrong
          </h2>
          <pre className="mt-3 max-w-xl overflow-auto rounded-md border border-danger/40 bg-danger/10 p-3 text-left font-mono text-xs leading-relaxed text-foreground">
            {this.state.error.message}
          </pre>
          <p className="mt-3 text-xs text-muted">
            Details were written to gresui.log.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            window.location.reload();
          }}
        >
          <RotateCcw />
          Reload
        </Button>
      </div>
    );
  }
}
