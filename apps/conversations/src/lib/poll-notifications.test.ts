import { describe, test, expect } from "bun:test";
import { startNotificationPolling, type NotificationPollStore } from "./poll-notifications";
import type { ChannelNotification } from "../types";

/**
 * Regression for the `conversations watch --all` channel-notification timer
 * (todos d3c6b65e), site B.
 *
 * On base this loop was an inline `setInterval(async () => { try { ... }
 * finally { ... } })` in the watch command with NO catch, so a store failure
 * escaped as an unhandled rejection. The store is injected here, so the
 * failure is exact and the test is fast.
 */

const notification = (id: number): ChannelNotification => ({
  message_id: id,
  channel: "general",
  from_agent: "someone",
  preview: `preview ${id}`,
  priority: "normal",
  created_at: new Date(id * 1000).toISOString(),
} as ChannelNotification);

const failingStore = (error: Error): NotificationPollStore => ({
  readChannelNotifications: async () => { throw error; },
});

const settle = (ms = 220) => new Promise((r) => setTimeout(r, ms));

describe("startNotificationPolling — store failure visibility (regression d3c6b65e)", () => {
  test("reports the failure rather than going silent", async () => {
    const lines: string[] = [];
    const { stop } = startNotificationPolling({
      store: failingStore(new Error("NOTIFICATIONS_STORE_DOWN")),
      agent: "watcher",
      interval_ms: 20,
      on_notifications: () => {},
      on_poll_error: (line) => lines.push(line),
    });
    await settle();
    stop();

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain("NOTIFICATIONS_STORE_DOWN");
  });

  test("keeps polling after a failure and labels a sustained outage", async () => {
    const lines: string[] = [];
    let calls = 0;
    const { stop } = startNotificationPolling({
      store: { readChannelNotifications: async () => { calls++; throw new Error("DOWN"); } },
      agent: "watcher",
      interval_ms: 20,
      on_notifications: () => {},
      on_poll_error: (line) => lines.push(line),
    });
    await settle();
    stop();

    expect(calls).toBeGreaterThan(1);
    expect(lines.some((l) => l.includes("DEGRADED"))).toBe(true);
  });

  test("does not leak the rejection to the process", async () => {
    // An escaping rejection is what the CLI's unhandledRejection handler turns
    // into print-then-exit(1), killing the watcher on the first store blip.
    const seen: unknown[] = [];
    const onRejection = (reason: unknown) => seen.push(reason);
    process.on("unhandledRejection", onRejection);

    const { stop } = startNotificationPolling({
      store: failingStore(new Error("DOWN")),
      agent: "watcher",
      interval_ms: 20,
      on_notifications: () => {},
      on_poll_error: () => {},
    });
    await settle();
    stop();
    process.off("unhandledRejection", onRejection);

    expect(seen.length).toBe(0);
  });

  test("recovers and keeps delivering once the store returns", async () => {
    const lines: string[] = [];
    const delivered: number[] = [];
    let call = 0;
    const { stop } = startNotificationPolling({
      store: {
        readChannelNotifications: async () => {
          call++;
          if (call <= 3) throw new Error("DOWN");
          return [notification(call)];
        },
      },
      agent: "watcher",
      interval_ms: 20,
      on_notifications: (n) => { delivered.push(...n.map((x) => x.message_id)); },
      on_poll_error: (line) => lines.push(line),
    });
    await settle(400);
    stop();

    expect(lines.some((l) => l.includes("DEGRADED"))).toBe(true);
    expect(lines.some((l) => l.includes("RECOVERED"))).toBe(true);
    expect(delivered.length).toBeGreaterThan(0);
  });
});
