import { describe, test, expect } from "bun:test";
import { baselineChannelNotifications, readChannelNotificationsUnion, startNotificationPolling, type NotificationBaselineStore, type NotificationPollStore } from "./poll-notifications";
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

const markNothing = async (): Promise<number> => 0;

const failingStore = (error: Error): NotificationPollStore => ({
  readChannelNotifications: async () => { throw error; },
  markChannelNotificationsRead: markNothing,
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
      store: {
        readChannelNotifications: async () => { calls++; throw new Error("DOWN"); },
        markChannelNotificationsRead: markNothing,
      },
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
        markChannelNotificationsRead: markNothing,
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
      markChannelNotificationsRead: markNothing,
    };
  };

  test("a single identity behaves exactly as the single-agent read", async () => {
    const store = perIdentityStore();
    const { notifications: rows } = await readChannelNotificationsUnion(store, { agents: ["fabricius"] });
    expect(rows.map((r) => r.message_id)).toEqual([1]);
    expect(store.seen).toEqual(["fabricius"]);
  });

  test("reads BOTH queues and returns the union", async () => {
    const store = perIdentityStore();
    const { notifications: rows } = await readChannelNotificationsUnion(store, {
      agents: ["fabricius", "agent-chief-staff"],
    });
    expect(store.seen).toEqual(["fabricius", "agent-chief-staff"]);
    expect(rows.map((r) => r.message_id)).toEqual([1, 2]);
  });

  test("positive control: the second identity's traffic is invisible to the first alone", async () => {
    // Without this, "the union returned 2 rows" could not distinguish a real
    // union from a store that ignores `agent` and returns everything anyway.
    const store = perIdentityStore();
    const { notifications: onlyFirst } = await readChannelNotificationsUnion(store, { agents: ["fabricius"] });
    expect(onlyFirst.map((r) => r.message_id)).not.toContain(2);
  });

  test("de-duplicates a message both identities are subscribed to", async () => {
    const shared: NotificationPollStore = {
      readChannelNotifications: async () => [notification(7)],
      markChannelNotificationsRead: markNothing,
    };
    const { notifications: rows } = await readChannelNotificationsUnion(shared, {
      agents: ["fabricius", "agent-chief-staff"],
    });
    expect(rows.map((r) => r.message_id)).toEqual([7]);
  });

  test("returns the union in chronological order regardless of identity order", async () => {
    const store: NotificationPollStore = {
      readChannelNotifications: async (args) =>
        args.agent === "second-listed" ? [notification(1)] : [notification(5)],
      markChannelNotificationsRead: markNothing,
    };
    const { notifications: rows } = await readChannelNotificationsUnion(store, {
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
      markChannelNotificationsRead: markNothing,
    };
    await expect(
      readChannelNotificationsUnion(store, { agents: ["broken", "healthy"] }),
    ).rejects.toThrow("QUEUE_DOWN");
  });

  test("a later identity failure cannot acknowledge an earlier identity before delivery", async () => {
    const acknowledged: string[] = [];
    const store: NotificationPollStore = {
      readChannelNotifications: async (args) => {
        if (args.agent === "broken") throw new Error("QUEUE_DOWN");
        return [notification(3)];
      },
      markChannelNotificationsRead: async (agent) => {
        acknowledged.push(agent);
        return 1;
      },
    };

    await expect(
      readChannelNotificationsUnion(store, {
        agents: ["healthy", "broken"],
        mark_read: true,
      }),
    ).rejects.toThrow("QUEUE_DOWN");

    // The union was never delivered, so no queue may be acknowledged. On the
    // old path `healthy` was already marked read here and vanished on retry.
    expect(acknowledged).toEqual([]);
  });

  test("acknowledges each identity only after the caller delivers the complete union", async () => {
    const store = perIdentityStore();
    const acknowledged: Array<{ agent: string; ids: number[] }> = [];
    store.markChannelNotificationsRead = async (agent, ids) => {
      acknowledged.push({ agent, ids });
      return ids.length;
    };

    const batch = await readChannelNotificationsUnion(store, {
      agents: ["fabricius", "agent-chief-staff"],
      mark_read: true,
    });

    expect(batch.notifications.map((row) => row.message_id)).toEqual([1, 2]);
    expect(acknowledged).toEqual([]);

    // This call represents successful rendering/delivery by the watcher.
    await batch.markRead();
    expect(acknowledged).toEqual([
      { agent: "fabricius", ids: [1] },
      { agent: "agent-chief-staff", ids: [2] },
    ]);
    expect(batch.notifications.every((row) => row.unread === false)).toBe(true);
  });

  /**
   * The two above assert the acknowledgement CONTRACT against a store double
   * that records calls. This asserts the OUTCOME an operator cares about,
   * against a store that models the semantics the defect actually lived in:
   * `unread_only` hides anything already marked, so a stranded row is gone from
   * every later poll. Written independently while the fix above was being
   * authored, and kept because a contract test and an outcome test fail for
   * different reasons.
   */
  const unreadStore = (rowsByAgent: Record<string, number[]>) => {
    const read = new Set<number>();
    let failing: string | null = null;
    return {
      read,
      failIdentity(agent: string | null) { failing = agent; },
      readChannelNotifications: async (args: { agent: string; mark_read?: boolean }) => {
        if (args.agent === failing) throw new Error("STORE_503");
        const out = (rowsByAgent[args.agent] ?? [])
          .filter((id) => !read.has(id))
          .map(notification);
        // Honours mark_read the way the real store does, so a fix that simply
        // went on passing mark_read through would still be caught here.
        if (args.mark_read) for (const row of out) read.add(row.message_id);
        return out;
      },
      markChannelNotificationsRead: async (_agent: string, ids: number[]) => {
        for (const id of ids) read.add(id);
        return ids.length;
      },
    };
  };

  test("a transient failure on the second identity does not consume the first identity's inbox", async () => {
    const store = unreadStore({ first: [101, 102], second: [201] });
    store.failIdentity("second");

    await expect(
      readChannelNotificationsUnion(store, { agents: ["first", "second"], mark_read: true }),
    ).rejects.toThrow("STORE_503");
    expect([...store.read]).toEqual([]);

    // The store recovers. Every id must still be reachable — this is the line
    // that failed on the pass-through path, where 101 and 102 were gone.
    store.failIdentity(null);
    const recovered = await readChannelNotificationsUnion(store, {
      agents: ["first", "second"],
      mark_read: true,
    });
    expect(recovered.notifications.map((r) => r.message_id).sort((a, b) => a - b))
      .toEqual([101, 102, 201]);

    // And once delivered, they are consumed exactly once.
    await recovered.markRead();
    const afterDelivery = await readChannelNotificationsUnion(store, {
      agents: ["first", "second"],
      mark_read: true,
    });
    expect(afterDelivery.notifications).toEqual([]);
  });

  test("acknowledges nothing when mark_read was not requested", async () => {
    const store = unreadStore({ first: [101], second: [201] });
    const batch = await readChannelNotificationsUnion(store, { agents: ["first", "second"] });
    await batch.markRead();
    expect([...store.read]).toEqual([]);
  });
});

describe("baselineChannelNotifications", () => {
  test("ID 2 arriving during baseline remains live while pre-arm ID 1 is marked", async () => {
    const unread = new Set([1]);
    const marked: number[] = [];
    let insertedDuringBaseline = false;
    const insertConcurrentArrival = () => {
      if (insertedDuringBaseline) return;
      insertedDuringBaseline = true;
      unread.add(2);
    };
    const mark = (ids: number[]) => {
      for (const id of ids) {
        if (!unread.delete(id)) continue;
        marked.push(id);
      }
      return ids.length;
    };
    const store = {
      // This models the reviewed moving-set implementation: its first read
      // snapshots ID 1, then ID 2 arrives before acknowledgement. A repeated
      // read would see and consume ID 2 as baseline history.
      readChannelNotifications: async () => {
        const snapshot = [...unread].map(notification);
        insertConcurrentArrival();
        return snapshot;
      },
      markChannelNotificationsRead: async (_agent: string, ids: number[]) => mark(ids),
      // The fixed contract snapshots and acknowledges in one store operation.
      baselineChannelNotifications: async () => {
        const snapshot = [...unread];
        insertConcurrentArrival();
        return mark(snapshot);
      },
    } satisfies NotificationPollStore & NotificationBaselineStore;

    await baselineChannelNotifications(store, ["watcher"]);

    expect(marked).toEqual([1]);
    expect([...unread]).toEqual([2]);
  });
});

describe("startNotificationPolling — acknowledgement follows delivery", () => {
  /**
   * The loop only calls markRead() when the render callback returned normally.
   * Without a test, deleting that guard leaves the suite green while restoring
   * the loss: a renderer that throws would consume the rows it never printed.
   */
  test("a rendering failure leaves the notifications unacknowledged", async () => {
    const acknowledged: number[] = [];
    let served = false;
    const { stop } = startNotificationPolling({
      store: {
        readChannelNotifications: async () => {
          if (served) return [];
          served = true;
          return [notification(11)];
        },
        markChannelNotificationsRead: async (_agent, ids) => {
          acknowledged.push(...ids);
          return ids.length;
        },
      },
      agent: "watcher",
      interval_ms: 20,
      on_notifications: () => { throw new Error("RENDER_BOOM"); },
      on_poll_error: () => {},
    });
    await settle();
    stop();

    expect(acknowledged).toEqual([]);
  });

  test("positive control: a rendering success DOES acknowledge", async () => {
    // Without this the test above would pass just as well against a loop that
    // never acknowledges anything at all.
    const acknowledged: number[] = [];
    let served = false;
    const { stop } = startNotificationPolling({
      store: {
        readChannelNotifications: async () => {
          if (served) return [];
          served = true;
          return [notification(12)];
        },
        markChannelNotificationsRead: async (_agent, ids) => {
          acknowledged.push(...ids);
          return ids.length;
        },
      },
      agent: "watcher",
      interval_ms: 20,
      on_notifications: () => {},
      on_poll_error: () => {},
    });
    await settle();
    stop();

    expect(acknowledged).toEqual([12]);
  });
});

describe("startNotificationPolling — multiple identities", () => {
  test("polls every identity in the list", async () => {
    const seen: string[] = [];
    const { stop } = startNotificationPolling({
      store: {
        readChannelNotifications: async (args) => { seen.push(args.agent); return []; },
        markChannelNotificationsRead: markNothing,
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
        markChannelNotificationsRead: markNothing,
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
