// Live message polling. Routes EVERY read through the active Store (getStore),
// so `conversations watch` and the interactive TUI surface new messages from
// whichever transport is active — on-box SQLite (LocalStore) or the
// self_hosted/cloud HTTP API (ApiStore). Nothing here touches sqlite directly;
// reading the local db while the client was flipped to the cloud was the
// split-brain bug this eliminates.

import { getStore } from "./store/index.js";
import type { MessagePreview } from "../types.js";

export interface PollOptions {
  session_id?: string;
  to_agent?: string;
  channel?: string;
  interval_ms?: number;
  on_messages: (messages: MessagePreview[]) => void;
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
  const startedAt = Date.now();

  const createdAtMillis = (value: string): number => {
    // SQLite timestamps are UTC but omit the trailing Z; cloud timestamps are
    // already ISO strings. Normalize both before comparing to the call-time
    // boundary so an asynchronous worker seed cannot swallow a newly sent row.
    const normalized = /(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : `${value}Z`;
    return Date.parse(normalized);
  };

  // Seed from preview rows that predate this function call. Local reads now run
  // in a real worker, so a message can be written while that worker starts; the
  // call-time timestamp prevents such a new row from being swallowed into the
  // high-water mark. Equal-millisecond rows are conservatively treated as new.
  const seeded = store
    .readMessagePreviews({
      session_id: opts.session_id,
      to: opts.to_agent,
      channel: opts.channel,
      order: "desc",
      limit: 100,
    })
    .then((latest) => {
      for (const message of latest.messages) {
        if (createdAtMillis(message.created_at) < startedAt && message.id > lastSeenId) {
          lastSeenId = message.id;
        }
      }
    })
    .catch(() => {
      // A failed seed just means the first poll starts from id 0; never fatal.
    });

  const poll = async () => {
    if (stopped || inFlight) return;
    inFlight = true;

    try {
      await seeded;
      if (stopped) return;

      const page = await store.readMessagePreviews({
        session_id: opts.session_id,
        to: opts.to_agent,
        channel: opts.channel,
        since_id: lastSeenId,
        order: "asc",
      });

      if (page.messages.length > 0) {
        lastSeenId = page.messages[page.messages.length - 1].id;
        try {
          // Polling is a broad collection read, so it never upgrades previews
          // into full message bodies. Callers may fetch one exact id explicitly.
          opts.on_messages(page.messages);
        } catch (error) {
          console.error("Polling callback error:", error);
        }
      }
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
