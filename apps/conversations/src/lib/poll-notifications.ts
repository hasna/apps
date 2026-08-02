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
  }): Promise<ChannelNotification[]>;
}

export interface NotificationPollOptions {
  store: NotificationPollStore;
  agent: string;
  interval_ms?: number;
  limit?: number;
  on_notifications: (notifications: ChannelNotification[]) => void;
  /** Where poll failures are reported. Defaults to stderr. */
  on_poll_error?: PollHealthReporter;
}

const DEFAULT_INTERVAL_MS = 200;
const DEFAULT_LIMIT = 200;

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
      const notifications = (await opts.store.readChannelNotifications({
        agent: opts.agent,
        unread_only: true,
        limit: opts.limit ?? DEFAULT_LIMIT,
        mark_read: true,
      })).sort(
        (left, right) =>
          left.created_at.localeCompare(right.created_at) || left.message_id - right.message_id,
      );

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
