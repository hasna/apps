import { describe, test, expect } from "bun:test";
import { readChannelNotificationsUnion, startNotificationPolling, type NotificationPollStore } from "./poll-notifications";
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

/**
 * Multi-identity reads. A seat answering to both an agent name and a seat slug
 * has two disjoint queues; a watcher armed on one of them reports an empty
 * inbox for the other's traffic, at exit 0.
 */
describe("readChannelNotificationsUnion", () => {
  /** Returns id 1 for the first identity and id 2 for the second. */
  const perIdentityStore = (): NotificationPollStore & { seen: string[] } => {
    const seen: string[] = [];
    return {
      seen,
      readChannelNotifications: async (args) => {
        seen.push(args.agent);
        if (args.agent === "fabricius") return [notification(1)];
        if (args.agent === "agent-chief-staff") return [notification(2)];
        return [];
      },
    };
  };

  test("a single identity behaves exactly as the single-agent read", async () => {
    const store = perIdentityStore();
    const rows = await readChannelNotificationsUnion(store, { agents: ["fabricius"] });
    expect(rows.map((r) => r.message_id)).toEqual([1]);
    expect(store.seen).toEqual(["fabricius"]);
  });

  test("reads BOTH queues and returns the union", async () => {
    const store = perIdentityStore();
    const rows = await readChannelNotificationsUnion(store, {
      agents: ["fabricius", "agent-chief-staff"],
    });
    expect(store.seen).toEqual(["fabricius", "agent-chief-staff"]);
    expect(rows.map((r) => r.message_id)).toEqual([1, 2]);
  });

  test("positive control: the second identity's traffic is invisible to the first alone", async () => {
    // Without this, "the union returned 2 rows" could not distinguish a real
    // union from a store that ignores `agent` and returns everything anyway.
    const store = perIdentityStore();
    const onlyFirst = await readChannelNotificationsUnion(store, { agents: ["fabricius"] });
    expect(onlyFirst.map((r) => r.message_id)).not.toContain(2);
  });

  test("de-duplicates a message both identities are subscribed to", async () => {
    const shared: NotificationPollStore = {
      readChannelNotifications: async () => [notification(7)],
    };
    const rows = await readChannelNotificationsUnion(shared, {
      agents: ["fabricius", "agent-chief-staff"],
    });
    expect(rows.map((r) => r.message_id)).toEqual([7]);
  });

  test("returns the union in chronological order regardless of identity order", async () => {
    const store: NotificationPollStore = {
      readChannelNotifications: async (args) =>
        args.agent === "second-listed" ? [notification(1)] : [notification(5)],
    };
    const rows = await readChannelNotificationsUnion(store, {
      agents: ["first-listed", "second-listed"],
    });
    expect(rows.map((r) => r.message_id)).toEqual([1, 5]);
  });

  // A partial union is a silently-incomplete read, which is the exact failure
  // class this feature exists to remove. Surfacing the error lets the poll
  // loop's health reporter call it DEGRADED instead of printing a short answer.
  test("a failing identity surfaces as an error rather than a silently partial union", async () => {
    const store: NotificationPollStore = {
      readChannelNotifications: async (args) => {
        if (args.agent === "broken") throw new Error("QUEUE_DOWN");
        return [notification(3)];
      },
    };
    await expect(
      readChannelNotificationsUnion(store, { agents: ["broken", "healthy"] }),
    ).rejects.toThrow("QUEUE_DOWN");
  });
});

describe("startNotificationPolling — multiple identities", () => {
  test("polls every identity in the list", async () => {
    const seen: string[] = [];
    const { stop } = startNotificationPolling({
      store: {
        readChannelNotifications: async (args) => { seen.push(args.agent); return []; },
      },
      agent: "fabricius",
      agents: ["fabricius", "agent-chief-staff"],
      interval_ms: 20,
      on_notifications: () => {},
      on_poll_error: () => {},
    });
    await settle();
    stop();

    expect(seen).toContain("fabricius");
    expect(seen).toContain("agent-chief-staff");
  });

  test("without an agents list it polls only the single agent — default unchanged", async () => {
    const seen: string[] = [];
    const { stop } = startNotificationPolling({
      store: {
        readChannelNotifications: async (args) => { seen.push(args.agent); return []; },
      },
      agent: "fabricius",
      interval_ms: 20,
      on_notifications: () => {},
      on_poll_error: () => {},
    });
    await settle();
    stop();

    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(["fabricius"]));
  });
});
