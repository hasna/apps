import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createChannel } from "./channels.js";
import {
  getMessageById,
  pinMessage,
  sendMessage,
} from "./messages.js";
import {
  readChannelNotifications,
  subscribeToChannelNotifications,
} from "./channel-notifications.js";
import { closeDb, getDb } from "./db.js";
import { LocalStore } from "./store/index.js";
import {
  activeLocalReadWorkerCountForTests,
  LocalCollectionTimeoutError,
  runLocalCancellationProbeForTests,
} from "./local-read-runner.js";
import {
  createDisposableStore,
  enterHermeticTestEnv,
} from "../test/hermetic.js";

let disposable: ReturnType<typeof createDisposableStore>;
let restoreEnv: () => void;

beforeEach(() => {
  disposable = createDisposableStore("safe-read-remediation");
  restoreEnv = enterHermeticTestEnv({
    CONVERSATIONS_DB_PATH: disposable.dbPath,
    CONVERSATIONS_EXPORT_DIR: `${disposable.dbPath}.exports`,
  });
  closeDb();
});

afterEach(() => {
  closeDb();
  restoreEnv();
  disposable.cleanup();
});

describe("E-00051 safe public read boundaries", () => {
  test("the default TUI uses preview pages, exact-id detail, and id-scoped acknowledgement", () => {
    const source = readFileSync(
      new URL("../cli/components/ChatView.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("readMessagePreviews");
    expect(source).toContain("getMessageById");
    expect(source).toContain("markReadByIds");
    expect(source).not.toMatch(/\breadMessages\b/);
    expect(source).not.toMatch(/\bmarkChannelRead\b/);
    expect(source).not.toMatch(/\bmarkSessionRead\b/);
  });

  test("LocalStore broad collection methods never return restricted bodies or raw fields", async () => {
    const channel = "security-incidents";
    const rawBody = "needle restricted root cause body";
    createChannel(channel, "creator");
    const root = sendMessage({
      from: "alice",
      to: channel,
      channel,
      session_id: `channel:${channel}`,
      content: rawBody,
      blocking: true,
      metadata: { internal_note: "raw-metadata-must-not-escape" },
    });
    getDb().prepare("UPDATE messages SET attachments = ? WHERE id = ?").run(
      JSON.stringify([{ name: "evidence.txt", path: "/private/evidence.txt", size: 42, mime_type: "text/plain" }]),
      root.id,
    );
    pinMessage(root.id);
    sendMessage({
      from: "bob",
      to: channel,
      channel,
      session_id: `channel:${channel}`,
      content: `@reader ${rawBody} reply`,
      reply_to: root.id,
    });

    const store = new LocalStore();
    const results = {
      read: await store.readMessages({ channel }),
      search: await store.searchMessages({ query: "needle", channel }),
      thread: await store.getThreadReplies(root.id),
      blockers: await store.getUnreadBlockers(channel, { limit: 20 }),
      mentions: await store.getMessagesForAgent("reader", { channel, limit: 20 }),
      pinned: await store.getPinnedMessages({ channel, limit: 20 }),
    };
    const serialized = JSON.stringify(results);

    expect(serialized).not.toContain(rawBody);
    expect(serialized).not.toContain("raw-metadata-must-not-escape");
    expect(serialized).not.toContain("/private/evidence.txt");
    expect(serialized).toContain("[REDACTED:RESTRICTED_CHANNEL_BODY]");

    // Exact-id disclosure remains the one explicit full-body path.
    expect(getMessageById(root.id)?.content).toBe(rawBody);
  });

  test("default export is a bounded preview projection without bodies, metadata, or attachments", async () => {
    const channel = "security-export";
    const rawBody = "restricted export body must not be serialized";
    createChannel(channel, "creator");
    const message = sendMessage({
      from: "alice",
      to: channel,
      channel,
      content: rawBody,
      metadata: { raw: "metadata" },
    });
    getDb().prepare("UPDATE messages SET attachments = ? WHERE id = ?").run(
      JSON.stringify([{ name: "private.txt", path: "/private/private.txt", size: 1, mime_type: "text/plain" }]),
      message.id,
    );

    const artifact = await new LocalStore().exportMessages({ channel, format: "json" });
    expect(artifact.path).toBeTruthy();
    const payload = readFileSync(artifact.path!, "utf8");
    expect(Buffer.byteLength(payload, "utf8")).toBeLessThanOrEqual(64 * 1024);
    expect(artifact.byte_length).toBe(Buffer.byteLength(payload, "utf8"));
    expect(artifact.download_path).toBeNull();
    expect(payload).not.toContain(rawBody);
    expect(payload).not.toContain("/private/private.txt");
    expect(payload).toContain("[REDACTED:RESTRICTED_CHANNEL_BODY]");
    const exported = JSON.parse(payload) as Array<Record<string, unknown>>;
    expect(exported[0].content).toBeUndefined();
    expect(exported[0].metadata).toBeUndefined();
    expect(exported[0].attachments).toBeUndefined();
  });

  test("notification reads are cursor pages and explicit mark_read acknowledges only returned ids", () => {
    createChannel("ops", "creator");
    subscribeToChannelNotifications("ops", "reader");
    const first = sendMessage({ from: "alice", to: "ops", channel: "ops", content: "first" });
    const second = sendMessage({ from: "alice", to: "ops", channel: "ops", content: "second" });
    const third = sendMessage({ from: "alice", to: "ops", channel: "ops", content: "third" });

    const firstPage = readChannelNotifications({
      agent: "reader",
      limit: 2,
      max_bytes: 8 * 1024,
      timeout_ms: 1_000,
      mark_read: true,
    });

    expect(Array.isArray(firstPage)).toBe(false);
    expect(firstPage.notifications.map((item) => item.message_id)).toEqual([third.id, second.id]);
    expect(firstPage.notifications.every((item) => item.unread === false)).toBe(true);
    expect(firstPage.marked_read).toBe(2);
    expect(firstPage.has_more).toBe(true);
    expect(firstPage.next_cursor).toBe(second.id);
    expect(firstPage.byte_length).toBeLessThanOrEqual(firstPage.max_bytes);

    const remaining = readChannelNotifications({ agent: "reader", limit: 20 });
    expect(remaining.notifications.map((item) => item.message_id)).toEqual([first.id]);
  });

  test("local collection deadlines terminate the SQLite worker with no late mutation or worker leak", async () => {
    // Initialize the disposable schema before the worker starts its deliberately
    // long read. The only write in the worker is sequenced after that read.
    getDb();
    const startedAt = performance.now();
    let caught: unknown;
    try {
      await runLocalCancellationProbeForTests(500);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(LocalCollectionTimeoutError);
    expect((caught as LocalCollectionTimeoutError).queryStarted).toBe(true);
    expect(performance.now() - startedAt).toBeLessThan(1_500);
    expect(activeLocalReadWorkerCountForTests()).toBe(0);

    // Acquiring an exclusive transaction proves the killed worker no longer has
    // a live SQLite statement/connection; the marker proves it never ran late.
    const db = getDb();
    db.exec("BEGIN EXCLUSIVE");
    db.exec("ROLLBACK");
    const marker = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'local_read_cancellation_probe'",
    ).get();
    expect(marker).toBeNull();
  });
});
