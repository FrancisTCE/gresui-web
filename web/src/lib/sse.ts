// Live event stream from the backend (`GET /events`, Server-Sent Events).
//
// Not EventSource: that API cannot set request headers, and the RPC token is
// a header here on purpose — putting it in the query string would leak it into
// logs and history. `fetch()` with a streaming body gives us the header and
// the same framing, at the cost of parsing SSE ourselves (which is ten lines).

import type { AppEvent } from "../../../shared/types.ts";

export type StreamStatus = "connecting" | "open" | "closed";

export interface StreamHandlers {
  onEvent(e: AppEvent): void;
  onStatus(s: StreamStatus): void;
}

/** Open the stream and keep it open. Returns a function that closes it for
 * good — reconnects stop, and the backend drops the subscription. */
export function openEventStream(h: StreamHandlers): () => void {
  const ctrl = new AbortController();
  let stopped = false;
  // Backs off on repeated failure so a backend that is down (or an old build
  // with no /events route) is not hammered once a second forever.
  let delay = 1000;

  const loop = async (): Promise<void> => {
    // `stopped` is set by the closer this function returns, which a linter
    // reading only the loop body cannot see.
    // oxlint-disable-next-line no-unmodified-loop-condition
    while (!stopped) {
      h.onStatus("connecting");
      try {
        await pump(ctrl.signal, h);
        delay = 1000; // a clean run means the endpoint is healthy
      } catch {
        // Fall through to the backoff; the status below says we are down.
      }
      if (stopped) break;
      h.onStatus("closed");
      await sleep(delay, ctrl.signal);
      delay = Math.min(delay * 2, 30_000);
    }
  };
  void loop();

  return () => {
    stopped = true;
    ctrl.abort();
    h.onStatus("closed");
  };
}

async function pump(signal: AbortSignal, h: StreamHandlers): Promise<void> {
  const token = globalThis.__GRESUI_TOKEN__;
  const res = await fetch("/events", {
    headers: {
      accept: "text/event-stream",
      ...(token ? { "x-gresui-token": token } : {}),
    },
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`event stream: HTTP ${res.status}`);
  h.onStatus("open");

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += value;
    // Frames are separated by a blank line; anything after the last one is a
    // partial frame that finishes in a later chunk.
    let cut = buf.indexOf("\n\n");
    while (cut !== -1) {
      dispatch(buf.slice(0, cut), h);
      buf = buf.slice(cut + 2);
      cut = buf.indexOf("\n\n");
    }
  }
}

function dispatch(frame: string, h: StreamHandlers): void {
  const data = frame
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trimStart())
    .join("\n");
  if (data === "") return; // comment frame — the keep-alive ping
  try {
    h.onEvent(JSON.parse(data) as AppEvent);
  } catch {
    // A frame we cannot parse is not worth tearing the stream down for.
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}
