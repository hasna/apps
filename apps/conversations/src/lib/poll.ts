// Live message polling. Routes EVERY read through the active Store (getStore),
// so `conversations watch` and the interactive TUI surface new messages from
// whichever transport is active — on-box SQLite (LocalStore) or the
// self_hosted/cloud HTTP API (ApiStore). Nothing here touches sqlite directly;
// reading the local db while the client was flipped to the cloud was the
// split-brain bug this eliminates.

import { getStore } from "./store/index.js";
import { createPollHealth, type PollHealthReporter } from "./poll-health.js";
import type { Message } from "../types.js";

export interface PollOptions {
  session_id?: string;
  to_agent?: string;
  channel?: string;
  interval_ms?: number;
  on_messages: (messages: Message[]) => void;
  /** Where poll failures are reported. Defaults to stderr. */
  on_poll_error?: PollHealthReporter;
}

/**
 * Start polling for new messages. Returns a stop function. Reads flow through
 * the active {@link getStore} transport, so the same loop works in local and
 * cloud modes.
 */
export function startPolling(opts: PollOptions): { stop: () => void } {
  const interval = opts.interval_ms ?? 200;
  const store = getStore();
  let stopped = false;
  let inFlight = false;
  let lastSeenId = 0;

  // Seed lastSeenId at call time so we never replay messages that already
  // existed when watching began. The read is issued synchronously (the local
  // transport resolves inline; the cloud transport on the next tick) and every
  // poll awaits it before querying, keeping the "only NEW messages" contract in
  // both modes.
  const health = createPollHealth({ label: "watch", report: opts.on_poll_error });

  const seeded = store
    .readMessages({
      session_id: opts.session_id,
      to: opts.to_agent,
      channel: opts.channel,
      order: "desc",
      limit: 1,
    })
    .then((latest) => {
      if (latest.length > 0 && latest[0].id > lastSeenId) lastSeenId = latest[0].id;
    })
    .catch((error: unknown) => {
      // Still not fatal — the first poll simply starts from id 0 — but it is
      // reported rather than swallowed. A failed seed means the store was
      // already unreachable at startup, and starting from 0 will replay
      // history once it returns; an operator seeing a flood needs this line to
      // explain it.
      health.recordFailure(error);
    });

  const poll = async () => {
    if (stopped || inFlight) return;
    inFlight = true;

    try {
      await seeded;
      if (stopped) return;

      const messages = await store.readMessages({
        session_id: opts.session_id,
        to: opts.to_agent,
        channel: opts.channel,
        since_id: lastSeenId,
        order: "asc",
      });

      health.recordSuccess();

      if (messages.length > 0) {
        lastSeenId = messages[messages.length - 1].id;
        try {
          opts.on_messages(messages);
        } catch (error) {
          console.error("Polling callback error:", error);
        }
      }
    } catch (error) {
      // A store failure must not end the loop and must not be silent. Without
      // this, the rejection escapes through the `void poll()` below: under the
      // CLI's process-level unhandledRejection handler that prints and calls
      // process.exit(1), so the watcher dies on the first blip; with no such
      // handler it is swallowed and the watcher goes blind. Both look, to the
      // operator, exactly like an inbox with nothing in it.
      health.recordFailure(error);
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => {
    void poll();
  }, interval);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
