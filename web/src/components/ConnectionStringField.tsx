// Paste-a-connection-string row for the connect form.
//
// This is an *input* for the fields below it, not a second source of truth:
// a valid string fills the form immediately, and from then on the form is
// what gets saved and connected. That keeps one config with two editors
// rather than two configs to reconcile.
import { AlertCircle, Check, Copy, Link2, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import {
  describeConnection,
  formatConnectionString,
  parseConnectionString,
  type ParsedConnection,
} from "@/lib/conn-string.ts";

export function ConnectionStringField({
  current,
  onApply,
  onCopyFailed,
}: {
  /** The form's present values, for the copy-out direction. */
  current: ParsedConnection;
  /** Called on every keystroke that parses cleanly. */
  onApply(parsed: ParsedConnection): void;
  onCopyFailed(message: string): void;
}) {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  const result = text.trim() === "" ? null : parseConnectionString(text);

  function update(next: string): void {
    setText(next);
    const parsed = parseConnectionString(next);
    if (parsed.ok && parsed.value) onApply(parsed.value);
  }

  async function copy(): Promise<void> {
    const s = formatConnectionString(current);
    try {
      await navigator.clipboard.writeText(s);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused even on a secure origin; show the
      // string in the box so it can still be selected by hand.
      setText(s);
      onCopyFailed("Could not reach the clipboard — the string is in the box.");
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor="conn-string" className="flex items-center gap-1.5">
          <Link2 className="size-3.5 text-subtle" />
          Connection string
        </Label>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px]"
              onClick={() => void copy()}
            >
              {copied ? <Check className="text-accent-text" /> : <Copy />}
              {copied ? "Copied" : "Copy from fields"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Builds a URI from the fields below and copies it. It contains the
            password.
          </TooltipContent>
        </Tooltip>
      </div>

      <Input
        id="conn-string"
        value={text}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => update(e.target.value)}
        placeholder="postgresql://user:password@host:5432/database?sslmode=require"
        className="font-mono text-xs"
        aria-describedby="conn-string-status"
        aria-invalid={result !== null && !result.ok}
      />

      <div id="conn-string-status" aria-live="polite" className="min-h-4">
        {result === null
          ? (
            <p className="text-[11px] text-subtle">
              Paste a URI or a <code className="text-muted">key=value</code>
              {" "}
              string to fill in the fields below.
            </p>
          )
          : result.ok && result.value
          ? (
            <p className="flex items-start gap-1.5 text-[11px] text-accent-text">
              <Check className="mt-px size-3 shrink-0" />
              <span className="font-mono">{describeConnection(result.value)}</span>
            </p>
          )
          : (
            <p className="flex items-start gap-1.5 text-[11px] text-danger-text">
              <AlertCircle className="mt-px size-3 shrink-0" />
              {result.error}
            </p>
          )}
        {result?.warnings.map((w) => (
          <p
            key={w}
            className="flex items-start gap-1.5 text-[11px] text-warning-text"
          >
            <TriangleAlert className="mt-px size-3 shrink-0" />
            {w}
          </p>
        ))}
      </div>
    </div>
  );
}
