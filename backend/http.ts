// Node http ⇄ Fetch adapter.
//
// The request handlers in this backend are written against the web Request /
// Response types (what Bun.serve handed them). Node has had both as globals
// since 18, so the handlers stay untouched — only the listener changes.
//
// Bodies are buffered rather than streamed: every route here is a small JSON
// RPC call or a file read off disk, and buffering keeps the adapter free of
// half-duplex plumbing.

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { ignoreError } from "../shared/noop.ts";

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

function toRequest(
  req: IncomingMessage,
  fallbackHost: string,
  body: Buffer,
): Request {
  // Loopback-only server: the Host header is the app's own origin.
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? fallbackHost}`,
  );
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else headers.set(name, value);
  }
  const method = req.method ?? "GET";
  const bodyless = method === "GET" || method === "HEAD";
  const init: RequestInit = { method, headers };
  if (!bodyless && body.length > 0) {
    // Not `body` itself: a Node Buffer is typed over ArrayBufferLike, which
    // is not a DOM BufferSource. The copy is bounded by MAX_BODY.
    init.body = new Uint8Array(body);
  }
  return new Request(url, init);
}

async function writeResponse(res: ServerResponse, r: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  r.headers.forEach((value, name) => {
    headers[name] = value;
  });
  // Headers.forEach folds repeated set-cookie into one comma-joined string.
  const cookies = r.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) headers["set-cookie"] = cookies;

  // An event stream is the one route that must not be buffered: its whole
  // point is that the first chunk arrives now and the connection stays open.
  if (
    r.body &&
    (r.headers.get("content-type") ?? "").includes("text/event-stream")
  ) {
    await pipeStream(res, r.status, r.body, headers);
    return;
  }

  const body = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, headers);
  res.end(body);
}

/** Pump a ReadableStream to the socket until either end hangs up. */
async function pipeStream(
  res: ServerResponse,
  status: number,
  body: ReadableStream<Uint8Array>,
  headers: Record<string, string | string[]>,
): Promise<void> {
  // Nagle would sit on the small writes an event stream is made of.
  res.socket?.setNoDelay(true);
  // Keep-alive timeouts must not close a stream that is idle on purpose.
  res.setTimeout(0);
  res.writeHead(status, headers);
  res.flushHeaders();

  const reader = body.getReader();
  let open = true;
  const stop = (): void => {
    if (!open) return;
    open = false;
    void reader.cancel().catch(ignoreError);
  };
  // The client navigating away or closing the tab lands here; cancelling the
  // reader is what lets the route release its subscription.
  res.on("close", stop);

  try {
    // `open` is cleared by stop(), from the "close" handler above — which a
    // linter reading only this loop body cannot see.
    while (open) {
      const { done, value } = await reader.read();
      if (done) break;
      // A full write buffer means the client is not keeping up; wait for
      // drain rather than growing the buffer without bound.
      if (!res.write(value) && open) {
        await new Promise<void>((resolve) => res.once("drain", resolve));
      }
    }
  } catch {
    // Broken pipe / cancelled reader — nothing to report, the client is gone.
  } finally {
    open = false;
    res.end();
  }
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
      server.on("error", (err) =>
        console.error(`http server error: ${err.message}`),
      );
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
