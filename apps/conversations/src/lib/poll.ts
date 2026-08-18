// Live message polling. Routes EVERY read through the active Store (getStore),
// so `conversations watch` and the interactive TUI surface new messages from
// whichever transport is active — on-box SQLite (LocalStore) or the HTTP API
// (ApiStore). Nothing here touches sqlite directly;
// reading the local db while the client was flipped to the cloud was the
// split-brain bug this eliminates.

import { getStore, type ConversationsStore } from "./store/index.js";
import { createPollHealth, type PollHealthReporter } from "./poll-health.js";
import { readMessages as readLocalMessages } from "./messages.js";
import type { Message } from "../types.js";

export interface PollOptions {
  session_id?: string;
  to_agent?: string;
  channel?: string;
  interval_ms?: number;
  on_messages: (messages: Message[]) => void;
  /** Where poll failures are reported. Defaults to stderr. */
  on_poll_error?: PollHealthReporter;
  /**
   * The store to read through. Defaults to the ambient {@link getStore}.
   *
   * This exists so a test can point ONE loop at an unreachable endpoint
   * without mutating `process.env`. `getStore(env = process.env)` re-reads the
   * environment on every call and does not cache, so a test that flips those
   * variables process-wide silently re-points every other live poll loop in
   * the process at the same endpoint — which is how a closed-port fixture in
   * one file produced real HTTP traffic inside another (todos 19c79404).
   */
  store?: ConversationsStore;
}

export interface PollHandle {
  /**
   * Resolves once the arm-time cursor seed has finished.
   *
   * A caller that prints a readiness signal must await this first, or a message
   * sent after the signal can still be absorbed into the seed as history.
   */
  ready: Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Start polling for new messages. Returns readiness and stop handles. Reads
 * flow through the active {@link getStore} transport, so the same loop works
 * for the local store and the hosted API.
 */
export function startPolling(opts: PollOptions): PollHandle {
  const interval = opts.interval_ms ?? 200;
  const store = opts.store ?? getStore();
  let stopped = false;
  let inFlight = false;
  let lastSeenId = 0;
  let seeded = false;
  let seedAttempt: Promise<void> | null = null;
  /** The read currently in flight, so `stop()` can wait for it to finish. */
  let current: Promise<void> | null = null;

  // Seed lastSeenId at call time so we never replay messages that already
  // existed when watching began. The read is issued synchronously (the local
  // transport resolves inline; the cloud transport on the next tick) and every
  // poll awaits it before querying, keeping the "only NEW messages" contract in
  // both modes.
  const health = createPollHealth({ label: "watch", report: opts.on_poll_error });

  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const readMessages =
    (args: {
      session_id?: string;
      to?: string;
      channel?: string;
      since_id?: number;
      order?: "asc" | "desc";
      limit?: number;
    }): Promise<Message[]> =>
      store.transport === "local" && !opts.store
        ? Promise.resolve(readLocalMessages(args))
        : store.readMessages(args);

  const ensureSeeded = (): Promise<void> => {
    if (seeded) return Promise.resolve();
    if (seedAttempt) return seedAttempt;

    seedAttempt = readMessages({
      session_id: opts.session_id,
      to: opts.to_agent,
      channel: opts.channel,
      order: "desc",
      limit: 1,
    })
      .then((latest) => {
        if (latest.length > 0 && latest[0].id > lastSeenId) lastSeenId = latest[0].id;
        seeded = true;
        health.recordSuccess();
        resolveReady();
      })
      .catch((error: unknown) => {
        // A failed arm-time read is reported and retried, but readiness stays
        // pending. Starting live polling from id 0 would replay pre-arm history
        // immediately after claiming that the watcher was ready.
        health.recordFailure(error);
      })
      .finally(() => {
        seedAttempt = null;
      });

    return seedAttempt;
  };

  // Issue the first seed read immediately. Timer ticks retry it after a
  // transient failure, without allowing live delivery until one succeeds.
  void ensureSeeded();

  const poll = async () => {
    try {
      await ensureSeeded();
      if (stopped || !seeded) return;

      const messages = await readMessages({
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
      // this, the rejection escapes through the `tick()` below: under the
      // CLI's process-level unhandledRejection handler that prints and calls
      // process.exit(1), so the watcher dies on the first blip; with no such
      // handler it is swallowed and the watcher goes blind. Both look, to the
      // operator, exactly like an inbox with nothing in it.
      health.recordFailure(error);
    }
  };

  // A tick that is dropped by the in-flight guard MUST NOT overwrite the
  // tracked promise, or `stop()` would wait on an already-resolved one and the
  // real read would outlive it — which is the whole defect being fixed.
  const tick = () => {
    if (stopped || inFlight) return;
    inFlight = true;
    const running = poll().finally(() => {
      inFlight = false;
      if (current === running) current = null;
    });
    current = running;
  };

  const timer = setInterval(tick, interval);

  return {
    ready,
    /**
     * Stop the loop AND wait until it is quiescent.
     *
     * Clearing the interval is not enough. A read already in flight keeps
     * running — the HTTP transport retries idempotent GETs with backoff, so a
     * single failing read can keep calling the global `fetch` for hundreds of
     * milliseconds after `stop()` returns. In a `bun test` run every file
     * shares one process and one `globalThis`, so that straggler lands in
     * whichever later test has since swapped in its own `fetch`, and fails an
     * assertion in a file this loop has nothing to do with (todos 19c79404).
     *
     * Awaiting the returned promise is therefore how a caller knows the loop
     * has stopped touching shared state. Callers that do not care may ignore
     * it, exactly as before.
     */
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await Promise.allSettled([seedAttempt, current]);
    },
  };
}
