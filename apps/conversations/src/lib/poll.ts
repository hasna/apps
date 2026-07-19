// Live message polling. Routes EVERY read through the active Store (getStore),
// so `conversations watch` and the interactive TUI surface new messages from
// whichever transport is active — on-box SQLite (LocalStore) or the
// self_hosted/cloud HTTP API (ApiStore). Nothing here touches sqlite directly;
// reading the local db while the client was flipped to the cloud was the
// split-brain bug this eliminates.

import { getStore } from "./store/index.js";
import type { Message } from "../types.js";

export interface PollOptions {
  session_id?: string;
  to_agent?: string;
  channel?: string;
  interval_ms?: number;
  on_messages: (messages: Message[]) => void;
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
  const seeded = store
    .readMessagePreviews({
      session_id: opts.session_id,
      to: opts.to_agent,
      channel: opts.channel,
      order: "desc",
      limit: 1,
    })
    .then((latest) => {
      if (latest.messages.length > 0 && latest.messages[0].id > lastSeenId) lastSeenId = latest.messages[0].id;
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
        const messages = (await Promise.all(page.messages.map((preview) => store.getMessageById(preview.id))))
          .filter((message): message is Message => message !== null);
        try {
          opts.on_messages(messages);
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
