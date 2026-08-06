// SqlEditor — CodeMirror wrapper: SQL language, theme-aware syntax, Mod-Enter run.
import { sql } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import CodeMirror from "@uiw/react-codemirror";
import { useCallback, useMemo } from "react";

const darkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#7dd3fc" },
  { tag: tags.string, color: "#86efac" },
  { tag: tags.number, color: "#fdba74" },
  { tag: tags.comment, color: "#8b93a1", fontStyle: "italic" },
  { tag: tags.operator, color: "#dde1e6" },
  { tag: tags.function(tags.variableName), color: "#c4b5fd" },
  { tag: tags.punctuation, color: "#dde1e6" },
  { tag: tags.typeName, color: "#93c5fd" },
  { tag: tags.bool, color: "#f472b6" },
  { tag: tags.null, color: "#f472b6" },
  { tag: tags.propertyName, color: "#a5b4fc" },
]);

const lightHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#0550ae" },
  { tag: tags.string, color: "#0a3069" },
  { tag: tags.number, color: "#953800" },
  { tag: tags.comment, color: "#6e7781", fontStyle: "italic" },
  { tag: tags.operator, color: "#24292f" },
  { tag: tags.function(tags.variableName), color: "#6639ba" },
  { tag: tags.punctuation, color: "#24292f" },
  { tag: tags.typeName, color: "#116329" },
  { tag: tags.bool, color: "#cf222e" },
  { tag: tags.null, color: "#cf222e" },
  { tag: tags.propertyName, color: "#8250df" },
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
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": {
        fontFamily: "ui-monospace, Menlo, Consolas, monospace",
        backgroundColor: "var(--bg)",
      },
      ".cm-content": {
        padding: "8px 0",
        backgroundColor: "var(--bg)",
        color: "var(--text)",
      },
      ".cm-gutters": {
        backgroundColor: "var(--bg-raised)",
        color: "var(--text-muted)",
        border: "none",
      },
      ".cm-activeLine": { backgroundColor: "var(--bg-hover)" },
      ".cm-activeLineGutter": {
        backgroundColor: "var(--bg-hover)",
        color: "var(--text)",
      },
      ".cm-cursor": { borderLeftColor: "var(--accent)" },
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
      syntaxHighlighting(theme === "dark" ? darkHighlight : lightHighlight),
      Prec.high(
        keymap.of([
          { key: "Mod-Enter", run: () => (onRun(), true) },
          { key: "Shift-Enter", run: () => (onRun(), true) },
        ]),
      ),
    ],
    [onRun, theme],
  );

  const handleChange = useCallback(
    (v: string) => onChange(v),
    [onChange],
  );

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
