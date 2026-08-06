// Typed access to the `bindings` global exposed by `deno desktop`.
import type { Bindings } from "../../../shared/rpc.ts";

declare global {
  // eslint-disable-next-line no-var
  var bindings: Bindings;
  // Injected into index.html by the backend (web mode only).
  var __GRESUI_TOKEN__: string | undefined;
}

export function hasBindings(): boolean {
  return typeof globalThis.bindings !== "undefined";
}

/** Desktop webview bindings when present, else the HTTP-RPC proxy (web mode). */
export function getBindings(): Bindings {
  if (hasBindings()) return globalThis.bindings;
  return httpBindings();
}

let httpProxy: Bindings | undefined;

function httpBindings(): Bindings {
  if (!httpProxy) {
    httpProxy = new Proxy({} as Bindings, {
      get: (_t, method) => (...args: unknown[]) => rpc(String(method), args),
    });
  }
  return httpProxy;
}

/**
 * POST to the backend's /rpc endpoint. Mirrors the desktop envelope:
 * 200 + `{result}` / `{error:{name,message}}`; the guard failures
 * (400/401/403) also carry the error envelope.
 */
async function rpc(method: string, args: unknown[]): Promise<unknown> {
  const token = globalThis.__GRESUI_TOKEN__;
  let res: Response;
  try {
    res = await fetch("/rpc", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-gresui-token": token } : {}),
      },
      body: JSON.stringify({ method, args }),
    });
  } catch {
    throw new Error("Cannot reach the gresui backend — is the server running?");
  }
  let body: { result?: unknown; error?: { name?: string; message?: string } };
  try {
    body = await res.json();
  } catch {
    body = {}; // unparseable body — no envelope
  }
  if (body.error) {
    const err = new Error(body.error.message ?? "RPC error");
    if (body.error.name) err.name = body.error.name;
    throw err;
  }
  if (!res.ok) {
    throw new Error("gresui backend error (HTTP " + res.status + ")");
  }
  return body.result;
}

/**
 * Await a binding call; normalizes a rejected `{name, message}` into an
 * `Error(message)` with `err.name` preserved.
 */
export async function call<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    const obj = e as { name?: string; message?: string };
    const err = new Error(obj.message ?? String(e));
    if (obj.name) err.name = obj.name;
    throw err;
  }
}
