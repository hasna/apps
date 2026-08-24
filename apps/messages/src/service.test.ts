/**
 * Domain tests for @hasna/messages — the single domain implementation.
 * Runs against the SQLite store (zero-config default) so the suite needs no
 * external services.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { MessagesService, newThreadId, threadKeyFor } from "./service";
import { SqliteMessagesStore } from "./server/sqlite-store";

function testService(): { service: MessagesService; db: Database } {
  const db = new Database(":memory:");
  const store = new SqliteMessagesStore(db);
  return { service: new MessagesService(store), db };
}

describe("thread identity", () => {
  test("thread key is order-independent", () => {
    expect(threadKeyFor("augustus", "silvanus")).toBe(threadKeyFor("silvanus", "augustus"));
  });
});

describe("MessagesService", () => {
  test("send creates a message and a thread, visible from both sides", async () => {
    const { service } = testService();
    const result = await service.send({
      from_agent: "augustus",
      to_agent: "silvanus",
      content: "hello",
    });

    expect(result.message.from_agent).toBe("augustus");
    expect(result.message.to_agent).toBe("silvanus");
    expect(result.message.thread_id).toBe(newThreadId("augustus", "silvanus"));

    const augustusThreads = await service.threads("augustus");
    const silvanusThreads = await service.threads("silvanus");
    expect(augustusThreads).toHaveLength(1);
    expect(silvanusThreads).toHaveLength(1);
    expect(silvanusThreads[0]!.unread_count).toBe(1);
    expect(augustusThreads[0]!.unread_count).toBe(0);
  });

  test("rejects self-messaging and empty content", async () => {
    const { service } = testService();
    await expect(
      service.send({ from_agent: "augustus", to_agent: "augustus", content: "hi" }),
    ).rejects.toThrow("two distinct agents");
    await expect(
      service.send({ from_agent: "augustus", to_agent: "silvanus", content: "  " }),
    ).rejects.toThrow("content is required");
  });

  test("markRead clears unread for the reading side only", async () => {
    const { service } = testService();
    await service.send({ from_agent: "augustus", to_agent: "silvanus", content: "hello" });
    await service.markRead(newThreadId("augustus", "silvanus"), "silvanus");

    const silvanusThreads = await service.threads("silvanus");
    expect(silvanusThreads[0]!.unread_count).toBe(0);
    expect(await service.unreadCount("silvanus")).toBe(0);
  });

  test("threads: reply chains stay in one thread and history is oldest-first", async () => {
    const { service } = testService();
    const first = await service.send({ from_agent: "augustus", to_agent: "silvanus", content: "one" });
    // Ordering is by created_at; space the sends so the tie-breaker (id) never
    // decides. Same-millisecond ordering is unspecified at v0.1.
    await Bun.sleep(2);
    await service.send({
      from_agent: "silvanus",
      to_agent: "augustus",
      content: "two",
      reply_to: first.message.id,
    });

    const messages = await service.threadMessages(first.message.thread_id);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.content).toBe("one");
    expect(messages[1]!.content).toBe("two");
    expect(messages[1]!.reply_to).toBe(first.message.id);
    expect(messages[1]!.from_agent).toBe("silvanus");
  });

  test("unknown thread read rejects", async () => {
    const { service } = testService();
    await expect(service.threadMessages("t_nope__nope")).rejects.toThrow("thread not found");
  });
});
