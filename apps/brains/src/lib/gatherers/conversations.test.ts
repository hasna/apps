// agent-authored (no SOL consult available)

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

interface MessageSeed {
  id: number;
  sessionId: string;
  fromAgent: string;
  toAgent?: string | null;
  space?: string | null;
  content: string;
  createdAt: string;
}

function createConversationsDb(homeDir: string, seeds: MessageSeed[]): void {
  const dbDir = join(homeDir, ".conversations");
  mkdirSync(dbDir, { recursive: true });
  const db = new Database(join(dbDir, "messages.db"));
  try {
    db.run(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        from_agent TEXT NOT NULL,
        to_agent TEXT,
        space TEXT,
        content TEXT NOT NULL,
        priority TEXT,
        created_at TEXT NOT NULL,
        reply_to INTEGER
      )
    `);
    for (const seed of seeds) {
      db.run(
        `INSERT INTO messages (id, session_id, from_agent, to_agent, space, content, priority, created_at, reply_to)
         VALUES (?, ?, ?, ?, ?, ?, 'normal', ?, NULL)`,
        seed.id,
        seed.sessionId,
        seed.fromAgent,
        seed.toAgent ?? null,
        seed.space ?? null,
        seed.content,
        seed.createdAt,
      );
    }
  } finally {
    db.close();
  }
}

function rolesOf(example: { messages: Array<{ role: string }> }): string[] {
  return example.messages.map((m) => m.role);
}

describe("gatherFromConversations", () => {
  test("a missing database file surfaces SQLITE_CANTOPEN instead of a fake empty result", async () => {
    const { gatherFromConversations } = await import("./conversations.js");
    const homeDir = join(tmpdir(), `brains-conv-missing-${Date.now()}`);
    try {
      // The gatherer opens ~/.conversations/messages.db with create: false —
      // a missing file must not silently read as "no conversations".
      await expect(gatherFromConversations({ homeDir })).rejects.toMatchObject({
        code: "SQLITE_CANTOPEN",
      });
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("empty messages table produces zero examples", async () => {
    const homeDir = join(tmpdir(), `brains-conv-empty-${Date.now()}`);
    createConversationsDb(homeDir, []);
    try {
      const { gatherFromConversations } = await import("./conversations.js");
      const result = await gatherFromConversations({ homeDir });
      expect(result.source).toBe("conversations");
      expect(result.count).toBe(0);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("a single-message session produces no examples", async () => {
    const homeDir = join(tmpdir(), `brains-conv-single-${Date.now()}`);
    createConversationsDb(homeDir, [
      { id: 1, sessionId: "s1", fromAgent: "a", toAgent: "b", content: "only", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    try {
      const { gatherFromConversations } = await import("./conversations.js");
      const result = await gatherFromConversations({ homeDir });
      expect(result.count).toBe(0);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("four-message session yields three sliding windows with alternating roles", async () => {
    const homeDir = join(tmpdir(), `brains-conv-4msg-${Date.now()}`);
    createConversationsDb(homeDir, [
      { id: 1, sessionId: "s1", fromAgent: "alice", toAgent: "bob", content: "m0", createdAt: "2026-01-01T00:00:01.000Z" },
      { id: 2, sessionId: "s1", fromAgent: "bob", toAgent: "alice", content: "m1", createdAt: "2026-01-01T00:00:02.000Z" },
      { id: 3, sessionId: "s1", fromAgent: "alice", toAgent: "bob", content: "m2", createdAt: "2026-01-01T00:00:03.000Z" },
      { id: 4, sessionId: "s1", fromAgent: "bob", toAgent: "alice", content: "m3", createdAt: "2026-01-01T00:00:04.000Z" },
    ]);
    try {
      const { gatherFromConversations } = await import("./conversations.js");
      const result = await gatherFromConversations({ homeDir });

      expect(result.count).toBe(3);

      // Window 0: [m0, m1, m2, m3] — alternating user/assistant, last is assistant
      const first = result.examples[0]!;
      expect(rolesOf(first)).toEqual(["system", "user", "assistant", "user", "assistant"]);
      expect(first.messages[1]?.content).toContain("m0");
      expect(first.messages[2]?.content).toContain("m1");
      expect(first.messages[3]?.content).toContain("m2");
      expect(first.messages[4]?.content).toContain("m3");

      // Window 1: [m1, m2, m3] — starts at index 1 so m1 is user
      const second = result.examples[1]!;
      expect(rolesOf(second)).toEqual(["system", "user", "assistant", "assistant"]);
      expect(second.messages[1]?.content).toContain("m1");
      expect(second.messages[2]?.content).toContain("m2");
      expect(second.messages[3]?.content).toContain("m3");

      // Window 2: [m2, m3]
      const third = result.examples[2]!;
      expect(rolesOf(third)).toEqual(["system", "user", "assistant"]);
      expect(third.messages[1]?.content).toContain("m2");
      expect(third.messages[2]?.content).toContain("m3");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("five-message session produces four windows (4,4,3,2)", async () => {
    const homeDir = join(tmpdir(), `brains-conv-5msg-${Date.now()}`);
    createConversationsDb(homeDir, [
      { id: 1, sessionId: "s1", fromAgent: "a", toAgent: "b", content: "m0", createdAt: "2026-01-01T00:00:01.000Z" },
      { id: 2, sessionId: "s1", fromAgent: "b", toAgent: "a", content: "m1", createdAt: "2026-01-01T00:00:02.000Z" },
      { id: 3, sessionId: "s1", fromAgent: "a", toAgent: "b", content: "m2", createdAt: "2026-01-01T00:00:03.000Z" },
      { id: 4, sessionId: "s1", fromAgent: "b", toAgent: "a", content: "m3", createdAt: "2026-01-01T00:00:04.000Z" },
      { id: 5, sessionId: "s1", fromAgent: "a", toAgent: "b", content: "m4", createdAt: "2026-01-01T00:00:05.000Z" },
    ]);
    try {
      const { gatherFromConversations } = await import("./conversations.js");
      const result = await gatherFromConversations({ homeDir });
      expect(result.count).toBe(4);
      // Windows are [m0..m3], [m1..m4], [m2..m4], [m3..m4] → 4,4,3,2 messages,
      // each example additionally carries the leading system message.
      expect(result.examples.map((e) => e.messages.length)).toEqual([5, 5, 4, 3]);
      // The final window [m3, m4] must end with m4 as the assistant turn
      const last = result.examples[3]!;
      expect(last.messages[last.messages.length - 1]?.content).toContain("m4");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("messages within a session are ordered by created_at ascending", async () => {
    const homeDir = join(tmpdir(), `brains-conv-order-${Date.now()}`);
    // Insert deliberately out of chronological order
    createConversationsDb(homeDir, [
      { id: 2, sessionId: "s1", fromAgent: "b", toAgent: "a", content: "later", createdAt: "2026-01-01T00:00:02.000Z" },
      { id: 1, sessionId: "s1", fromAgent: "a", toAgent: "b", content: "earlier", createdAt: "2026-01-01T00:00:01.000Z" },
    ]);
    try {
      const { gatherFromConversations } = await import("./conversations.js");
      const result = await gatherFromConversations({ homeDir });
      expect(result.count).toBe(1);
      const example = result.examples[0]!;
      expect(example.messages[1]?.content).toContain("earlier");
      expect(example.messages[2]?.content).toContain("later");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("sessions are grouped separately — windows never cross sessions", async () => {
    const homeDir = join(tmpdir(), `brains-conv-group-${Date.now()}`);
    createConversationsDb(homeDir, [
      { id: 1, sessionId: "sA", fromAgent: "a1", toAgent: "b1", content: "A0", createdAt: "2026-01-01T00:00:01.000Z" },
      { id: 2, sessionId: "sA", fromAgent: "b1", toAgent: "a1", content: "A1", createdAt: "2026-01-01T00:00:02.000Z" },
      { id: 3, sessionId: "sB", fromAgent: "x1", toAgent: "y1", content: "B0", createdAt: "2026-01-01T00:00:03.000Z" },
      { id: 4, sessionId: "sB", fromAgent: "y1", toAgent: "x1", content: "B1", createdAt: "2026-01-01T00:00:04.000Z" },
    ]);
    try {
      const { gatherFromConversations } = await import("./conversations.js");
      const result = await gatherFromConversations({ homeDir });
      expect(result.count).toBe(2);
      const contents = result.examples.map((e) => e.messages.map((m) => m.content).join("|"));
      // No example mixes session A and session B content
      for (const c of contents) {
        expect(c.includes("A0") && c.includes("B0")).toBe(false);
        expect(c.includes("A1") && c.includes("B1")).toBe(false);
      }
      expect(contents.some((c) => c.includes("A0") && c.includes("A1"))).toBe(true);
      expect(contents.some((c) => c.includes("B0") && c.includes("B1"))).toBe(true);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("recipient formatting falls back to space, then to 'all'", async () => {
    const homeDir = join(tmpdir(), `brains-conv-recipient-${Date.now()}`);
    createConversationsDb(homeDir, [
      { id: 1, sessionId: "s1", fromAgent: "a", toAgent: "b", content: "direct", createdAt: "2026-01-01T00:00:01.000Z" },
      { id: 2, sessionId: "s1", fromAgent: "b", toAgent: null, space: "#room", content: "channel", createdAt: "2026-01-01T00:00:02.000Z" },
      { id: 3, sessionId: "s2", fromAgent: "c", toAgent: null, space: null, content: "broadcast", createdAt: "2026-01-01T00:00:03.000Z" },
      { id: 4, sessionId: "s2", fromAgent: "d", toAgent: null, space: null, content: "reply", createdAt: "2026-01-01T00:00:04.000Z" },
    ]);
    try {
      const { gatherFromConversations } = await import("./conversations.js");
      const result = await gatherFromConversations({ homeDir });
      const contents = result.examples.map((e) => e.messages.map((m) => m.content).join("|"));
      expect(contents.some((c) => c.includes("[a → b]: direct"))).toBe(true);
      expect(contents.some((c) => c.includes("[b → #room]: channel"))).toBe(true);
      expect(contents.some((c) => c.includes("[c → all]: broadcast"))).toBe(true);
      expect(contents.some((c) => c.includes("[d → all]: reply"))).toBe(true);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("since filter keeps only messages at or after the date", async () => {
    const homeDir = join(tmpdir(), `brains-conv-since-${Date.now()}`);
    createConversationsDb(homeDir, [
      { id: 1, sessionId: "s1", fromAgent: "a", toAgent: "b", content: "old", createdAt: "2026-01-01T00:00:01.000Z" },
      { id: 2, sessionId: "s1", fromAgent: "b", toAgent: "a", content: "new", createdAt: "2026-01-02T00:00:00.000Z" },
      { id: 3, sessionId: "s1", fromAgent: "a", toAgent: "b", content: "newer", createdAt: "2026-01-03T00:00:00.000Z" },
    ]);
    try {
      const { gatherFromConversations } = await import("./conversations.js");
      // since = start of Jan 2 → old message excluded, new+newer remain
      const result = await gatherFromConversations({ homeDir, since: new Date("2026-01-02T00:00:00.000Z") });
      expect(result.count).toBe(1);
      const contents = result.examples.map((e) => e.messages.map((m) => m.content).join("|"));
      expect(contents.some((c) => c.includes("old"))).toBe(false);
      expect(contents[0]).toContain("new");
      expect(contents[0]).toContain("newer");

      // since after the newest message → nothing remains → zero examples
      const later = await gatherFromConversations({ homeDir, since: new Date("2026-02-01T00:00:00.000Z") });
      expect(later.count).toBe(0);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("limit caps the number of examples", async () => {
    const homeDir = join(tmpdir(), `brains-conv-limit-${Date.now()}`);
    createConversationsDb(homeDir, [
      { id: 1, sessionId: "s1", fromAgent: "a", toAgent: "b", content: "m0", createdAt: "2026-01-01T00:00:01.000Z" },
      { id: 2, sessionId: "s1", fromAgent: "b", toAgent: "a", content: "m1", createdAt: "2026-01-01T00:00:02.000Z" },
      { id: 3, sessionId: "s1", fromAgent: "a", toAgent: "b", content: "m2", createdAt: "2026-01-01T00:00:03.000Z" },
      { id: 4, sessionId: "s1", fromAgent: "b", toAgent: "a", content: "m3", createdAt: "2026-01-01T00:00:04.000Z" },
    ]);
    try {
      const { gatherFromConversations } = await import("./conversations.js");
      const result = await gatherFromConversations({ homeDir, limit: 2 });
      expect(result.count).toBe(2);
      expect(result.examples.length).toBe(2);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("every example begins with the system prompt", async () => {
    const homeDir = join(tmpdir(), `brains-conv-system-${Date.now()}`);
    createConversationsDb(homeDir, [
      { id: 1, sessionId: "s1", fromAgent: "a", toAgent: "b", content: "m0", createdAt: "2026-01-01T00:00:01.000Z" },
      { id: 2, sessionId: "s1", fromAgent: "b", toAgent: "a", content: "m1", createdAt: "2026-01-01T00:00:02.000Z" },
      { id: 3, sessionId: "s1", fromAgent: "a", toAgent: "b", content: "m2", createdAt: "2026-01-01T00:00:03.000Z" },
    ]);
    try {
      const { gatherFromConversations } = await import("./conversations.js");
      const result = await gatherFromConversations({ homeDir });
      expect(result.count).toBe(2);
      for (const example of result.examples) {
        expect(example.messages[0]?.role).toBe("system");
        expect(example.messages[0]?.content).toContain("multi-agent conversations");
      }
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
