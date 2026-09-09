// Node http ⇄ Fetch adapter.
//
// The request handlers in this backend are written against the web Request /
// Response types (what Bun.serve handed them). Node has had both as globals
// since 18, so the handlers stay untouched — only the listener changes.
//
// Bodies are buffered rather than streamed: every route here is a small JSON
// RPC call or a file read off disk, and buffering keeps the adapter free of
// half-duplex plumbing.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** Hard ceiling on a request body, before any route-level limit. */
const MAX_BODY = 8 * 1024 * 1024;

export interface Listener {
  /** The port actually bound — the caller may have asked for 0. */
  port: number;
  stop(): Promise<void>;
}

export interface ServeOptions {
  hostname: string;
  /** 0 binds a free port; read the real one back from `Listener.port`. */
  port: number;
  fetch(req: Request): Response | Promise<Response>;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function toRequest(req: IncomingMessage, fallbackHost: string, body: Buffer): Request {
  // Loopback-only server: the Host header is the app's own origin.
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? fallbackHost}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else headers.set(name, value);
  }
  const method = req.method ?? "GET";
  const bodyless = method === "GET" || method === "HEAD";
  return new Request(url, {
    method,
    headers,
    body: bodyless || body.length === 0 ? undefined : body,
  });
}

async function writeResponse(res: ServerResponse, r: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  r.headers.forEach((value, name) => {
    headers[name] = value;
  });
  // Headers.forEach folds repeated set-cookie into one comma-joined string.
  const cookies = r.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) headers["set-cookie"] = cookies;
  const body = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, headers);
  res.end(body);
}

/** Bind a loopback listener. Rejects when the port is unavailable, so callers
 * can fall back — Bun.serve threw synchronously for that; Node reports it on
 * the server's "error" event instead. */
export function serve(opts: ServeOptions): Promise<Listener> {
  return new Promise((resolve, reject) => {
    const fallbackHost = `${opts.hostname}:${opts.port}`;
    const server = createServer((req, res) => {
      void (async () => {
        try {
          const body = await readBody(req);
          const response = await opts.fetch(toRequest(req, fallbackHost, body));
          await writeResponse(res, response);
        } catch (err) {
          console.error(`request failed: ${(err as Error).message}`);
          if (!res.headersSent) {
            res.writeHead(500, { "content-type": "text/plain" });
          }
          res.end("Internal Server Error");
        }
      })();
    });

    const onListenError = (err: Error): void => reject(err);
    server.once("error", onListenError);
    server.listen(opts.port, opts.hostname, () => {
      server.removeListener("error", onListenError);
      // Past bind, an error event with no listener would take down the
      // process; a dropped client socket is not worth that.
      server.on("error", (err) => console.error(`http server error: ${err.message}`));
      resolve({
        port: (server.address() as AddressInfo).port,
        stop: () =>
          new Promise<void>((done) => {
            // close() alone waits on idle keep-alive sockets.
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
