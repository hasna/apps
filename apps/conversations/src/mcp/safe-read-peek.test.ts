/**
 * MCP collection reads are PEEKS, and their envelopes state their own bounds.
 *
 * Three closures share this fixture because they share one failure: an MCP
 * client asking "what is waiting for me?" and, purely by asking, destroying the
 * evidence that it was waiting.
 *
 *   - `read_messages` / `read_channel` mutated unless the caller passed
 *     `mark_read: false`. A default-on mutation means every naive client, every
 *     retry and every crashed-mid-render session silently consumed unread state.
 *     Reading is now non-mutating, and only `mark_read === true` acknowledges —
 *     restricted to the ids the very same call returned.
 *   - `mark_mentions_read` cleared EVERY unread mention for an agent (or an
 *     entire channel) from a request that named no message at all. It now acts
 *     on exact mention ids, and an explicitly empty list is a no-op.
 *   - The store's page envelope already carries `skipped_count`, `byte_length`,
 *     `max_bytes` and `timeout_ms`; the MCP adapters dropped all four and
 *     re-derived `has_more` from an over-fetch count. That is the dangerous
 *     direction: a page the store truncated on BYTES was reported to the client
 *     as `has_more: false` — a confident complete result over a partial read.
 *
 * The fixture follows envelope-ordering.test.ts: a private buildServer()
 * instance (session identity is keyed by McpServer instance) and `heartbeat`
 * rather than `register_agent`, which would write an identity file into $HOME.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-safe-read-peek-${Date.now()}.db`);
let client: Client;
let disposeBuiltServer: (() => Promise<void>) | undefined;

type Envelope = Record<string, unknown>;

function payloadOf(result: unknown): Envelope {
  const text = ((result as { content: Array<{ text: string }> }).content[0]).text;
  try {
    return JSON.parse(text) as Envelope;
  } catch {
    return { text };
  }
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<Envelope> {
  return payloadOf(await client.callTool({ name, arguments: args }));
}

const savedEnv: Record<string, string | undefined> = {};
function setEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeAll(async () => {
  setEnv("CONVERSATIONS_DB_PATH", TEST_DB);
  setEnv("CONVERSATIONS_AGENT_ID", "peek-reader");
  setEnv("CONVERSATIONS_USE_MACHINE_IDENTITY", undefined);

  const { closeDb } = await import("../lib/db.js");
  closeDb();

  const { buildServer, disposeServer } = await import("./index.js");
  const server = buildServer();
  disposeBuiltServer = () => disposeServer(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "safe-read-peek-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await disposeBuiltServer?.();
  const { closeDb } = await import("../lib/db.js");
  closeDb();
  const { _resetAutoName } = await import("../lib/identity.js");
  _resetAutoName();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(`${TEST_DB}${suffix}`); } catch {}
  }
});

async function unreadCount(to: string): Promise<number> {
  const envelope = await call("read_messages", { to, unread_only: true, limit: 100 });
  return Number(envelope.count ?? 0);
}

describe("G4 — MCP collection reads do not mutate by default", () => {
  test("read_messages leaves unread state intact when mark_read is omitted", async () => {
    await call("send_message", { to: "peek-dm-a", from: "peek-writer", content: "peek dm one" });
    await call("send_message", { to: "peek-dm-a", from: "peek-writer", content: "peek dm two" });

    expect(await unreadCount("peek-dm-a")).toBe(2);
    // The read itself is the thing under test: asking twice must answer twice.
    expect(await unreadCount("peek-dm-a")).toBe(2);
  });

  test("read_messages acknowledges only on an explicit mark_read:true", async () => {
    await call("send_message", { to: "peek-dm-b", from: "peek-writer", content: "peek ack one" });
    await call("send_message", { to: "peek-dm-b", from: "peek-writer", content: "peek ack two" });

    expect(await unreadCount("peek-dm-b")).toBe(2);
    // NB: `from` on read_messages is a SENDER FILTER, not the reader identity —
    // the reader comes from the connection's identity. Passing it here would
    // filter the page to nothing and the assertion would pass vacuously.
    await call("read_messages", { to: "peek-dm-b", unread_only: true, limit: 100, mark_read: true });
    expect(await unreadCount("peek-dm-b")).toBe(0);
  });

  test("an explicit mark_read:true acknowledges only the ids that page returned", async () => {
    for (let i = 1; i <= 4; i++) {
      await call("send_message", { to: "peek-dm-c", from: "peek-writer", content: `peek scoped ${i}` });
    }
    expect(await unreadCount("peek-dm-c")).toBe(4);

    // One page of two. The two rows outside the page must survive.
    await call("read_messages", { to: "peek-dm-c", unread_only: true, limit: 2, mark_read: true });
    expect(await unreadCount("peek-dm-c")).toBe(2);
  });

  test("read_channel consumes only the matching channel notifications by default", async () => {
    await call("create_channel", { name: "peek-chan" });
    await call("create_channel", { name: "peek-chan-other" });
    await call("subscribe_channel_notifications", { from: "peek-watcher", channel: "peek-chan" });
    await call("subscribe_channel_notifications", { from: "peek-watcher", channel: "peek-chan-other" });
    await call("send_to_channel", { channel: "peek-chan", from: "peek-writer", content: "channel body one" });
    await call("send_to_channel", { channel: "peek-chan-other", from: "peek-writer", content: "channel body two" });

    const before = await call("read_channel_notifications", { from: "peek-watcher" });
    expect(before.count).toBe(2);

    await call("read_channel", { channel: "peek-chan", from: "peek-watcher", limit: 10 });

    const after = await call("read_channel_notifications", { from: "peek-watcher" });
    expect(after.count).toBe(1);
    expect((after.notifications as Array<{ channel: string }>)[0]?.channel).toBe("peek-chan-other");
  });

  test("read_channel with mark_read:true does consume the notification", async () => {
    await call("create_channel", { name: "peek-chan-ack" });
    await call("subscribe_channel_notifications", { from: "peek-watcher-ack", channel: "peek-chan-ack" });
    await call("send_to_channel", { channel: "peek-chan-ack", from: "peek-writer", content: "channel body two" });

    expect((await call("read_channel_notifications", { from: "peek-watcher-ack" })).count).toBe(1);
    await call("read_channel", { channel: "peek-chan-ack", from: "peek-watcher-ack", limit: 10, mark_read: true });
    expect((await call("read_channel_notifications", { from: "peek-watcher-ack" })).count).toBe(0);
  });

  test("read_channel_notifications does not acknowledge unless asked", async () => {
    await call("create_channel", { name: "peek-notify" });
    await call("subscribe_channel_notifications", { from: "peek-notify-watcher", channel: "peek-notify" });
    await call("send_to_channel", { channel: "peek-notify", from: "peek-writer", content: "notify body" });

    expect((await call("read_channel_notifications", { from: "peek-notify-watcher" })).count).toBe(1);
    expect((await call("read_channel_notifications", { from: "peek-notify-watcher" })).count).toBe(1);
  });
});

describe("G5 — mention acknowledgement is exact-id only", () => {
  async function unreadMentions(agent: string): Promise<number> {
    return Number((await call("get_mentions", { agent, unread_only: true, limit: 100 })).count ?? 0);
  }

  test("mark_mentions_read refuses a request that names no mention", async () => {
    await call("create_channel", { name: "mention-scope" });
    await call("send_to_channel", { channel: "mention-scope", from: "peek-writer", content: "ping @mention-target one" });
    await call("send_to_channel", { channel: "mention-scope", from: "peek-writer", content: "ping @mention-target two" });
    expect(await unreadMentions("mention-target")).toBe(2);

    const broad = await call("mark_mentions_read", { agent: "mention-target" });
    expect(broad.cleared ?? 0).toBe(0);
    // The load-bearing assertion: an unnamed request must clear NOTHING.
    expect(await unreadMentions("mention-target")).toBe(2);
  });

  test("a channel-wide request is equally refused", async () => {
    const broad = await call("mark_mentions_read", { agent: "mention-target", channel: "mention-scope" });
    expect(broad.cleared ?? 0).toBe(0);
    expect(await unreadMentions("mention-target")).toBe(2);
  });

  test("an explicitly empty id list is a no-op, not a broad acknowledgement", async () => {
    const empty = await call("mark_mentions_read", { agent: "mention-target", mention_ids: [] });
    expect(empty.cleared).toBe(0);
    expect(await unreadMentions("mention-target")).toBe(2);
  });

  test("exact mention ids clear exactly those mentions", async () => {
    const page = await call("get_mentions", { agent: "mention-target", unread_only: true, limit: 100 });
    const ids = (page.mentions as Array<{ mention_id: number }>).map((row) => row.mention_id);
    expect(ids.length).toBe(2);

    const cleared = await call("mark_mentions_read", { agent: "mention-target", mention_ids: [ids[0]] });
    expect(cleared.cleared).toBe(1);
    expect(await unreadMentions("mention-target")).toBe(1);
  });
});

describe("G3 — MCP envelopes preserve the store's collection contract", () => {
  const CONTRACT_FIELDS = ["has_more", "next_cursor", "skipped_count", "byte_length", "max_bytes", "timeout_ms"];

  test("read_messages carries every bound the store page declared", async () => {
    await call("send_message", { to: "peek-envelope", from: "peek-writer", content: "envelope body" });
    const envelope = await call("read_messages", { to: "peek-envelope", limit: 5 });
    for (const field of CONTRACT_FIELDS) {
      expect(Object.keys(envelope)).toContain(field);
    }
    expect(typeof envelope.max_bytes).toBe("number");
    expect(typeof envelope.timeout_ms).toBe("number");
    expect(typeof envelope.skipped_count).toBe("number");
  });

  test("read_channel carries every bound the store page declared", async () => {
    await call("create_channel", { name: "peek-envelope-chan" });
    await call("send_to_channel", { channel: "peek-envelope-chan", from: "peek-writer", content: "chan envelope body" });
    const envelope = await call("read_channel", { channel: "peek-envelope-chan", limit: 5 });
    for (const field of CONTRACT_FIELDS) {
      expect(Object.keys(envelope)).toContain(field);
    }
  });

  test("get_mentions carries every bound the store page declared", async () => {
    const envelope = await call("get_mentions", { agent: "mention-target", limit: 5 });
    for (const field of CONTRACT_FIELDS) {
      expect(Object.keys(envelope)).toContain(field);
    }
  });

  /**
   * The one that matters. A byte cap small enough to drop rows must NOT be
   * reported as a complete page: `skipped_count` is non-zero and `has_more` is
   * true, so a client paging "until has_more is false" cannot stop early on a
   * result the store already knew was partial.
   */
  test("a byte-capped page reports truncation instead of claiming completeness", async () => {
    for (let i = 1; i <= 8; i++) {
      await call("send_message", {
        to: "peek-bytecap",
        from: "peek-writer",
        content: `byte cap probe ${i} ${"y".repeat(400)}`,
      });
    }
    const envelope = await call("read_messages", { to: "peek-bytecap", limit: 8, max_bytes: 1024 });
    const truncated = Number(envelope.skipped_count ?? 0) > 0 || Number(envelope.count ?? 0) < 8;
    expect(truncated).toBe(true);
    expect(envelope.has_more).toBe(true);
    expect(envelope.next_cursor).not.toBeNull();
  });
});
