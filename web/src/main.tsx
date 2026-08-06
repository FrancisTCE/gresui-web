import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.tsx";
import { call, getBindings } from "@/lib/rpc.ts";
import "./index.css";

// Forward renderer errors to the backend log file so a blank-window crash is
// diagnosable from gresui.log. Works in both modes: the webview bindings or
// the web-mode HTTP RPC (logError is a binding either way).
const report = (what: string, detail: unknown): void => {
  const text = detail instanceof Error
    ? `${detail.message}\n${detail.stack ?? ""}`
    : String(detail);
  call(getBindings().logError(`[webview] ${what}: ${text}`)).catch(() => {});
};
window.addEventListener("error", (e) => {
  report(`window.onerror at ${e.filename}:${e.lineno}`, e.error ?? e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  report("unhandledrejection", e.reason);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
