/**
 * Domain tests for @hasna/messages — the single domain implementation.
 * Runs against the SQLite store (zero-config default) so the suite needs no
 * external services.
 *
 * The delivery state machine (stored -> delivered -> read) is the repair for
 * the measured "conversations send --to" silent-success failure, so it gets
 * the most direct regression coverage: a stored-but-undelivered message must
 * be distinguishable from a delivered one, and the transition happens only
 * when the recipient drains its inbox.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { MessagesService, newThreadId, threadKeyFor } from "./service";
import { SqliteMessagesStore } from "./server/sqlite-store";
import type { MessageDelivery } from "./types";

function testService(): { service: MessagesService; db: Database } {
  const db = new Database(":memory:");
  const store = new SqliteMessagesStore(db);
  return { service: new MessagesService(store), db };
}

const A = "augustus";
const B = "silvanus";
const threadId = (a: string, b: string) => newThreadId(a, b);

function deliveryOf(deliveries: MessageDelivery[], recipient: string): MessageDelivery {
  const d = deliveries.find((x) => x.recipient === recipient);
  if (!d) throw new Error(`no delivery for ${recipient}`);
  return d;
}

describe("thread identity", () => {
  test("thread key is order-independent", () => {
    expect(threadKeyFor(A, B)).toBe(threadKeyFor(B, A));
    expect(newThreadId(A, B)).toBe(newThreadId(B, A));
  });

  test("thread key stays format-stable for plain names and collision-free for underscore names (REGRESSION: review P1s)", async () => {
    // Format stability: underscore-free names encode identically to the
    // legacy `t_<a>__<b>` (sorted), so existing thread rows keep resolving —
    // no migration (cycle-1 re-review P1).
    expect(newThreadId("augustus", "silvanus")).toBe("t_augustus__silvanus");
    // Collision freedom: `a`/`b__c` vs `a__b`/`c` and `0_`/`a` vs `0`/`_a`
    // must produce distinct keys (original P1 + final-review P1).
    expect(newThreadId("a", "b__c")).not.toBe(newThreadId("a__b", "c"));
    expect(newThreadId("0_", "a")).not.toBe(newThreadId("0", "_a"));
    // The escape is order-independent like the legacy format.
    expect(newThreadId("0_", "a")).toBe(newThreadId("a", "0_"));
    expect(newThreadId("0", "_a")).toBe(newThreadId("_a", "0"));
  });

  test("legacy underscore-named threads stay reachable via the grandfather fallback (REGRESSION: re-review P1)", async () => {
    const { service, db } = testService();
    // Seed a legacy thread row under the old unescaped id for an
    // underscore-named pair, as a 0.1.0-era store would hold it.
    const legacyId = "t_0___a";
    db.query(
      "INSERT INTO threads (id, agent_a, agent_b, last_message_at, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(legacyId, "0_", "a", new Date().toISOString(), new Date().toISOString());
    db.query("INSERT INTO thread_participants (thread_id, agent, joined_at) VALUES (?, ?, ?)").run(legacyId, "0_", new Date().toISOString());
    db.query("INSERT INTO thread_participants (thread_id, agent, joined_at) VALUES (?, ?, ?)").run(legacyId, "a", new Date().toISOString());

    // A send from the underscore-named pair adopts the legacy row instead of
    // splitting the history.
    const result = await service.send({ from_agent: "0_", to_agent: "a", content: "hi" });
    expect(result.message.thread_id).toBe(legacyId);
    const messages = await service.threadMessages(legacyId);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe("hi");

    // The colliding OTHER pair (`0`/`_a`) must NOT adopt the legacy row whose
    // participants are a different pair: it gets its own escaped thread.
    const other = await service.send({ from_agent: "0", to_agent: "_a", content: "yo" });
    expect(other.message.thread_id).not.toBe(legacyId);
    expect(newThreadId("0", "_a")).toBe(other.message.thread_id);
  });
});

describe("agent identity is first-class", () => {
  test("registerAgent creates a normalized identity; send auto-registers both sides", async () => {
    const { service } = testService();
    const agent = await service.registerAgent("Augustus", "CEO seat");
    expect(agent.name).toBe("augustus");
    expect(agent.display_name).toBe("CEO seat");
    expect(agent.id).toBeTruthy();

    await service.send({ from_agent: "augustus", to_agent: "silvanus", content: "hello" });
    const agents = await service.listAgents();
    expect(agents.map((a) => a.name).sort()).toEqual(["augustus", "silvanus"]);
  });
});

describe("MessagesService", () => {
  test("send creates a message, a thread, and a per-recipient 'stored' delivery", async () => {
    const { service } = testService();
    const result = await service.send({ from_agent: A, to_agent: B, content: "hello" });

    expect(result.message.from_agent).toBe(A);
    expect(result.message.thread_id).toBe(threadId(A, B));
    expect(result.message.seq).toBe(1);
    // Per-recipient delivery: the recipient's record starts 'stored'.
    expect(result.deliveries).toHaveLength(1);
    expect(deliveryOf(result.deliveries, B).state).toBe("stored");
    expect(deliveryOf(result.deliveries, B).delivered_at).toBeNull();
    expect(deliveryOf(result.deliveries, B).read_at).toBeNull();

    const augustusThreads = await service.threads(A);
    const silvanusThreads = await service.threads(B);
    expect(augustusThreads).toHaveLength(1);
    expect(silvanusThreads).toHaveLength(1);
    expect(silvanusThreads[0]!.unread_count).toBe(1);
    expect(augustusThreads[0]!.unread_count).toBe(0); // own messages are not unread
  });

  test("THE REPAIR: a stored-but-undelivered message is distinguishable from a delivered one", async () => {
    const { service } = testService();
    await service.send({ from_agent: A, to_agent: B, content: "not yet pulled" });

    // Before the recipient drains its inbox, delivery state is 'stored'.
    let report = await service.deliveryStatus(threadId(A, B));
    expect(report).toHaveLength(1);
    expect(report[0]!.deliveries).toHaveLength(1);
    expect(report[0]!.deliveries[0]!.state).toBe("stored");
    // Still counted unread (stored but not read).
    expect(await service.threadUnread(threadId(A, B), B)).toBe(1);

    // The recipient drains its inbox -> stored -> delivered.
    const received = await service.receive(B);
    expect(received).toHaveLength(1);
    expect(received[0]!.to_agent).toBe(B);
    expect(received[0]!.delivery.state).toBe("delivered");
    expect(received[0]!.delivery.delivered_at).not.toBeNull();

    report = await service.deliveryStatus(threadId(A, B));
    expect(report[0]!.deliveries[0]!.state).toBe("delivered");

    // A second drain delivers nothing (no duplicates).
    expect(await service.receive(B)).toHaveLength(0);
  });

  test("markRead transitions delivered -> read and clears unread for the reading side only", async () => {
    const { service } = testService();
    await service.send({ from_agent: A, to_agent: B, content: "hello" });
    await service.receive(B);
    await service.markRead(threadId(A, B), B);

    const report = await service.deliveryStatus(threadId(A, B));
    expect(report[0]!.deliveries[0]!.state).toBe("read");
    expect(report[0]!.deliveries[0]!.read_at).not.toBeNull();
    expect(await service.threadUnread(threadId(A, B), B)).toBe(0);
    // The sender's own side never has a delivery row and is not unread.
    expect(await service.threadUnread(threadId(A, B), A)).toBe(0);
  });

  test("rejects self-messaging and empty content", async () => {
    const { service } = testService();
    await expect(
      service.send({ from_agent: A, to_agent: A, content: "hi" }),
    ).rejects.toThrow("two distinct agents");
    await expect(
      service.send({ from_agent: A, to_agent: B, content: "  " }),
    ).rejects.toThrow("content is required");
  });

  test("concurrent sends get unique per-thread seqs and no agent-registration race (REGRESSION: P1 review finding)", async () => {
    const { service } = testService();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        service.send({ from_agent: A, to_agent: B, content: `msg ${i}` }),
      ),
    );
    const seqs = results.map((r) => r.message.seq).sort((x, y) => x - y);
    // 12 sends, seqs must be exactly 1..12 with no duplicate and no gap.
    expect(seqs).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    // A fresh agent created concurrently from two sides must not fail on the
    // UNIQUE(name) insert: the loser re-reads the committed row.
    const [x, y] = await Promise.all([
      service.send({ from_agent: "newcomer", to_agent: B, content: "x" }),
      service.send({ from_agent: "newcomer", to_agent: B, content: "y" }),
    ]);
    expect(x.message.from_agent).toBe("newcomer");
    expect(y.message.from_agent).toBe("newcomer");
    expect((await service.listAgents()).map((a) => a.name)).toContain("newcomer");
  });

  test("threads: reply chains stay in one thread and history is oldest-first", async () => {
    const { service } = testService();
    const first = await service.send({ from_agent: A, to_agent: B, content: "one" });
    await Bun.sleep(2);
    await service.send({ from_agent: B, to_agent: A, content: "two", reply_to: first.message.id });

    const messages = await service.threadMessages(first.message.thread_id);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.content).toBe("one");
    expect(messages[0]!.seq).toBe(1);
    expect(messages[1]!.content).toBe("two");
    expect(messages[1]!.seq).toBe(2);
    expect(messages[1]!.reply_to).toBe(first.message.id);
    expect(messages[1]!.from_agent).toBe(B);
  });

  test("expandThread returns messages with the requesting agent's delivery state and does NOT mark read", async () => {
    const { service } = testService();
    await service.send({ from_agent: A, to_agent: B, content: "hello" });
    const expanded = await service.expandThread(threadId(A, B), B);
    expect(expanded.messages).toHaveLength(1);
    // The recipient sees their own delivery row (still 'stored' — expand is read-only).
    expect(expanded.messages[0]!.delivery!.state).toBe("stored");
    expect(expanded.unread_count).toBe(1);
    // The sender sees no delivery row (own message).
    const senderView = await service.expandThread(threadId(A, B), A);
    expect(senderView.messages[0]!.delivery).toBeNull();
  });

  test("unknown thread operations reject", async () => {
    const { service } = testService();
    await expect(service.threadMessages("t_nope__nope")).rejects.toThrow("thread not found");
    await expect(service.markRead("t_nope__nope", A)).rejects.toThrow("thread not found");
    await expect(service.closeThread("t_nope__nope", A)).rejects.toThrow("thread not found");
  });
});

describe("thread close/reopen", () => {
  test("close excludes the thread from the default list; --all includes it flagged closed; reopen restores it", async () => {
    const { service } = testService();
    const { message } = await service.send({ from_agent: A, to_agent: B, content: "hi" });
    const id = message.thread_id;

    expect((await service.threads(B)).map((t) => t.id)).toContain(id);

    await service.closeThread(id, B);
    const open = await service.threads(B);
    expect(open.map((t) => t.id)).not.toContain(id);
    const all = await service.threads(B, { openOnly: false });
    const closedSummary = all.find((t) => t.id === id)!;
    expect(closedSummary.closed).toBe(true);

    // Reopen brings it back to the default list.
    await service.reopenThread(id, B);
    const reopened = await service.threads(B);
    expect(reopened.find((t) => t.id === id)!.closed).toBe(false);
  });

  test("closing one side does not close the other's view", async () => {
    const { service } = testService();
    const { message } = await service.send({ from_agent: A, to_agent: B, content: "hi" });
    const id = message.thread_id;
    await service.closeThread(id, A);
    expect((await service.threads(B)).map((t) => t.id)).toContain(id);
    expect((await service.threads(A)).map((t) => t.id)).not.toContain(id);
  });
});

describe("unread accounting", () => {
  test("unreadThreads and unreadCount reflect only undelivered/read-state messages", async () => {
    const { service } = testService();
    await service.send({ from_agent: A, to_agent: B, content: "one" });
    await service.send({ from_agent: A, to_agent: B, content: "two" });
    expect(await service.unreadCount(B)).toBe(2);
    const unread = await service.unreadThreads(B);
    expect(unread).toHaveLength(1);
    expect(unread[0]!.unread_count).toBe(2);

    await service.receive(B);
    await service.markRead(threadId(A, B), B);
    expect(await service.unreadCount(B)).toBe(0);
    expect(await service.unreadThreads(B)).toHaveLength(0);
  });
});
