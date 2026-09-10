// SqlEditor — CodeMirror wrapper: SQL language, theme-aware syntax, Mod-Enter run.
import { sql } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import CodeMirror from "@uiw/react-codemirror";
import { useCallback, useMemo } from "react";

/* One highlight style for both themes: every colour is a token that already
   flips with .dark, and they are the same tokens the grid paints cell values
   with — a number reads the same in the editor as it does in a result row. */
const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--t-date)" },
  { tag: tags.string, color: "var(--accent-text)" },
  { tag: tags.number, color: "var(--t-number)" },
  { tag: tags.bool, color: "var(--t-bool)" },
  { tag: tags.null, color: "var(--t-bool)" },
  { tag: tags.typeName, color: "var(--t-uuid)" },
  { tag: tags.function(tags.variableName), color: "var(--t-json)" },
  { tag: tags.propertyName, color: "var(--text)" },
  { tag: tags.operator, color: "var(--text-muted)" },
  { tag: tags.punctuation, color: "var(--text-muted)" },
  { tag: tags.comment, color: "var(--text-subtle)", fontStyle: "italic" },
]);

function editorTheme(dark: boolean) {
  return EditorView.theme(
    {
      "&": {
        backgroundColor: "var(--bg)",
        color: "var(--text)",
        height: "100%",
        fontSize: "13px",
      },
      ".cm-line": { lineHeight: "1.6" },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": {
        fontFamily: "var(--font-mono)",
        backgroundColor: "var(--bg)",
      },
      ".cm-content": {
        padding: "8px 0",
        backgroundColor: "var(--bg)",
        color: "var(--text)",
      },
      ".cm-gutters": {
        backgroundColor: "var(--bg)",
        color: "var(--text-subtle)",
        border: "none",
        paddingRight: "4px",
      },
      ".cm-activeLine": { backgroundColor: "var(--bg-raised)" },
      ".cm-activeLineGutter": {
        backgroundColor: "var(--bg-raised)",
        color: "var(--text)",
      },
      ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
        backgroundColor: "var(--accent-soft)",
        outline: "1px solid var(--accent)",
      },
      ".cm-cursor": {
        borderLeftColor: "var(--accent)",
        borderLeftWidth: "2px",
      },
      ".cm-selectionBackground": { backgroundColor: "var(--selection)" },
      "&.cm-focused .cm-selectionBackground": {
        backgroundColor: "var(--selection)",
      },
    },
    { dark },
  );
}

export function SqlEditor({
  value,
  onChange,
  onRun,
  theme,
}: {
  value: string;
  onChange(v: string): void;
  onRun(): void;
  theme: "dark" | "light";
}) {
  const extensions = useMemo(
    () => [
      sql(),
      editorTheme(theme === "dark"),
      syntaxHighlighting(highlight),
      Prec.high(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              onRun();
              return true;
            },
          },
          {
            key: "Shift-Enter",
            run: () => {
              onRun();
              return true;
            },
          },
        ]),
      ),
    ],
    [onRun, theme],
  );

  const handleChange = useCallback((v: string) => onChange(v), [onChange]);

  return (
    <div className="h-full w-full overflow-hidden">
      <CodeMirror
        value={value}
        onChange={handleChange}
        extensions={extensions}
        height="100%"
        style={{ height: "100%" }}
      />
    </div>
  );
}
