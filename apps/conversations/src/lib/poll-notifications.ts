// Channel-notification polling for `conversations watch --all`.
//
// Extracted from the inline setInterval in the watch command so it can be
// tested directly and so it degrades identically to the message poll loop in
// ./poll.ts. Both report through ./poll-health.ts; an operator should not have
// to learn two vocabularies for the same outage.

import { createPollHealth, type PollHealthReporter } from "./poll-health.js";
import type { ChannelNotification } from "../types.js";

/** The slice of the store this loop needs; narrow so tests can supply a double. */
export interface NotificationPollStore {
  readChannelNotifications(args: {
    agent: string;
    unread_only?: boolean;
    limit?: number;
    mark_read?: boolean;
    include_content?: boolean;
  }): Promise<ChannelNotification[]>;
}

export interface NotificationPollOptions {
  store: NotificationPollStore;
  /** The primary identity. Anything this loop writes goes under this name. */
  agent: string;
  /**
   * Every identity to READ for, primary first. Defaults to `[agent]`, so a
   * caller that does not know about multi-identity keeps its existing
   * single-queue behaviour exactly.
   */
  agents?: string[];
  interval_ms?: number;
  limit?: number;
  /** Ask the store for full message bodies alongside the stripped preview. */
  include_content?: boolean;
  on_notifications: (notifications: ChannelNotification[]) => void;
  /** Where poll failures are reported. Defaults to stderr. */
  on_poll_error?: PollHealthReporter;
}

const DEFAULT_INTERVAL_MS = 200;
const DEFAULT_LIMIT = 200;

export interface UnionReadOptions {
  /** Identities to read for, primary first. */
  agents: string[];
  unread_only?: boolean;
  limit?: number;
  mark_read?: boolean;
  include_content?: boolean;
}

/**
 * Read channel notifications for several identities and return their union.
 *
 * A seat that answers to both an agent name and a seat slug has two disjoint
 * subscription sets; reading one of them and reporting the result as "the
 * inbox" is a confident wrong answer, not a partial one.
 *
 * Semantics that callers depend on:
 *
 * - **Union, de-duplicated by `message_id`.** Both identities may subscribe to
 *   the same channel, and the same message must not be rendered twice.
 * - **Chronological order**, so the output does not depend on the order the
 *   identities happened to be listed in.
 * - **`mark_read` stays per-identity.** Each queue marks only what it actually
 *   returned, which is that identity's own read state — not a write under
 *   somebody else's name.
 * - **A failing identity rejects the whole read.** Returning the identities
 *   that happened to answer would reintroduce the silently-short read this
 *   exists to remove; the caller's health reporter is the right place for it.
 */
export async function readChannelNotificationsUnion(
  store: NotificationPollStore,
  opts: UnionReadOptions,
): Promise<ChannelNotification[]> {
  const byId = new Map<number, ChannelNotification>();

  for (const agent of opts.agents) {
    const rows = await store.readChannelNotifications({
      agent,
      unread_only: opts.unread_only,
      limit: opts.limit,
      mark_read: opts.mark_read,
      include_content: opts.include_content,
    });
    for (const row of rows) {
      if (!byId.has(row.message_id)) byId.set(row.message_id, row);
    }
  }

  return [...byId.values()].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) || left.message_id - right.message_id,
  );
}

/**
 * Poll unread channel notifications for `agent`. Returns a stop function.
 *
 * A store failure is reported and the loop continues; it neither escapes as an
 * unhandled rejection (which the CLI turns into print-then-exit) nor vanishes.
 */
export function startNotificationPolling(opts: NotificationPollOptions): { stop: () => void } {
  const health = createPollHealth({
    label: "channel-notifications",
    report: opts.on_poll_error,
  });

  let stopped = false;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;

    try {
      const notifications = await readChannelNotificationsUnion(opts.store, {
        agents: opts.agents?.length ? opts.agents : [opts.agent],
        unread_only: true,
        limit: opts.limit ?? DEFAULT_LIMIT,
        mark_read: true,
        include_content: opts.include_content,
      });

      health.recordSuccess();

      if (notifications.length > 0) {
        try {
          opts.on_notifications(notifications);
        } catch (error) {
          // Matches the message loop: a rendering fault is the caller's, and
          // must not be mistaken for the store being unreachable.
          console.error("Notification callback error:", error);
        }
      }
    } catch (error) {
      health.recordFailure(error);
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, opts.interval_ms ?? DEFAULT_INTERVAL_MS);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
