// In-process pub/sub for things the UI has to learn about without asking.
//
// MCP tool calls arrive on the MCP listener, not on the RPC the frontend
// drives, so there is nothing for the UI to poll at the moment they happen.
// Publishers here are fire-and-forget: a slow or broken subscriber must never
// be able to delay — or fail — an agent's request.

import type { AppEvent } from "../shared/types.ts";

/** Re-exported so backend modules can name it without reaching into
 * shared/ for the type this file is the publisher of. */
export type { AppEvent };

type Listener = (e: AppEvent) => void;

const listeners = new Set<Listener>();

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function publish(e: AppEvent): void {
  for (const l of listeners) {
    try {
      l(e);
    } catch (err) {
      // A subscriber that throws is the subscriber's problem; the request
      // that triggered this must still succeed.
      console.error(`event listener failed: ${(err as Error).message}`);
    }
  }
}

/** Live subscriber count — the MCP path skips assembling an event payload
 * when nobody is watching. */
export function listenerCount(): number {
  return listeners.size;
}

