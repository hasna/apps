import { describe, expect, test } from "bun:test";
import { collectionPage, compactAgent, compactInboxItem, compactMessage } from "./compact-output.js";

describe("messages compact output", () => {
  test("bounds collections and truncates high-cardinality text by default", () => {
    const agents = Array.from({ length: 45 }, (_, i) => ({
      id: `agent-${i}`,
      name: `agent-${i}`,
      display_name: "d".repeat(200),
      created_at: "2026-09-18T00:00:00Z",
      last_seen_at: null,
    }));
    const page = collectionPage("agents", agents, {}, compactAgent);
    expect(page.agents).toHaveLength(20);
    expect(page.total).toBe(45);
    expect(page.next_cursor).toBe(20);
    expect(JSON.stringify(page)).not.toContain("d".repeat(120));
  });

  test("compact runtime inbox retains the delivery recipient", () => {
    const compact = compactInboxItem({
      message: { id: "m", thread_id: "t", from_agent: "sender", content: "hello", reply_to: null, created_at: "2026-09-18T00:00:00Z", seq: 1 },
      delivery: { recipient: "receiver", state: "stored", stored_at: "2026-09-18T00:00:00Z", delivered_at: null, read_at: null },
    });
    expect(compact.delivery).toEqual({ recipient: "receiver", state: "stored" });
  });

  test("verbose keeps full fields only within the selected page", () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({
      id: `m-${i}`, thread_id: "t", from_agent: "a", content: "x".repeat(500),
      reply_to: null, created_at: "2026-09-18T00:00:00Z", seq: i,
    }));
    const page = collectionPage("messages", messages, { limit: 2, verbose: true }, compactMessage);
    expect(page.messages).toHaveLength(2);
    expect(page.messages[0]!.content).toBe("x".repeat(500));
  });
});
