import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getMessageById,
  getReadReceipts,
  getUnreadBlockerPreviews,
  readMessagePreviews,
  searchMessagePreviews,
  sendMessage,
} from "./messages";
import { closeDb } from "./db";
import { resetStoreForTests } from "./store";
import {
  COLLECTION_MAX_LIMIT,
  RESTRICTED_CHANNEL_PREVIEW,
  resolveCollectionMaxBytes,
  resolveCollectionTimeoutMs,
} from "./message-previews";
import { createDisposableStore, enterHermeticTestEnv, installNetworkGuard } from "../test/hermetic";

describe("bounded message collection projections", () => {
  let cleanupStore: () => void;
  let restoreEnv: () => void;
  let restoreNetwork: () => void;

  beforeEach(() => {
    const store = createDisposableStore("safe-reads");
    cleanupStore = store.cleanup;
    restoreEnv = enterHermeticTestEnv({
      HASNA_CONVERSATIONS_STORAGE_MODE: "local",
      HASNA_CONVERSATIONS_MODE: "local",
      CONVERSATIONS_STORAGE_MODE: "local",
      CONVERSATIONS_MODE: "local",
      CONVERSATIONS_DB_PATH: store.dbPath,
      HASNA_CONVERSATIONS_API_URL: "https://ambient-route.invalid",
      HASNA_CONVERSATIONS_API_KEY: "synthetic-routing-key-not-a-credential",
    });
    restoreNetwork = installNetworkGuard();
    closeDb();
    resetStoreForTests();
  });

  afterEach(() => {
    closeDb();
    resetStoreForTests();
    restoreNetwork();
    restoreEnv();
    cleanupStore();
  });

  test("default list returns a byte-capped redacted projection without full content or read mutations", () => {
    const syntheticBearer = ["Bearer", `synthetic_${"a".repeat(48)}`].join(" ");
    const fullBody = `coordination note ${syntheticBearer} ${"x".repeat(2_000)}`;
    const sent = sendMessage({ from: "alice", to: "bob", content: fullBody, reply_to: undefined });

    const page = readMessagePreviews({ to: "bob", limit: 100_000, max_bytes: 1_024, timeout_ms: 1_000 });

    expect(page.limit).toBe(COLLECTION_MAX_LIMIT);
    expect(page.byte_length).toBeLessThanOrEqual(1_024);
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]).not.toHaveProperty("content");
    expect(page.messages[0].preview).toContain("[REDACTED:BEARER_TOKEN]");
    expect(JSON.stringify(page)).not.toContain(syntheticBearer);
    expect(page.messages[0].content_bytes).toBe(Buffer.byteLength(fullBody));
    expect(page.messages[0].reply_to).toBeNull();
    expect(getMessageById(sent.id)?.content).toBe(fullBody);
    expect(getMessageById(sent.id)?.read_at).toBeNull();
    expect(getReadReceipts(sent.id)).toEqual([]);
  });

  test("incident and security collection projections never expose a body or body-derived snippet", () => {
    const syntheticPat = `ghp_${"z".repeat(24)}`;
    sendMessage({
      from: "incident-bot",
      to: "security-incidents",
      channel: "security-incidents",
      content: `restricted coordination ${syntheticPat}`,
      blocking: true,
    });

    const page = readMessagePreviews({ channel: "security-incidents" });
    expect(page.messages[0].preview).toBe(RESTRICTED_CHANNEL_PREVIEW);
    expect(page.messages[0].redacted).toBe(true);
    expect(JSON.stringify(page)).not.toContain("restricted coordination");
    expect(JSON.stringify(page)).not.toContain(syntheticPat);
  });

  test("search and unread blocker collections return projections and remain non-mutating", () => {
    const normal = sendMessage({ from: "alice", to: "bob", content: "needle coordination update" });
    const blocker = sendMessage({ from: "alice", to: "bob", content: "needle blocker detail", blocking: true });
    const syntheticBearer = ["Bearer", `synthetic_${"b".repeat(48)}`].join(" ");
    sendMessage({ from: "alice", to: "bob", content: `needle secret ${syntheticBearer}` });

    const search = searchMessagePreviews({ query: "needle", to: "bob", max_bytes: 2_048 });
    expect(search.messages).toHaveLength(3);
    expect(search.messages.every((message) => !("content" in message))).toBe(true);
    expect(search.byte_length).toBeLessThanOrEqual(2_048);
    expect(JSON.stringify(search)).not.toContain(syntheticBearer);
    expect(search.messages.some((message) => message.preview.includes("[REDACTED:BEARER_TOKEN]"))).toBe(true);

    const credentialTermSearch = searchMessagePreviews({ query: "synthetic", to: "bob", max_bytes: 2_048 });
    expect(JSON.stringify(credentialTermSearch)).not.toContain(syntheticBearer);
    expect(credentialTermSearch.messages[0].preview).toContain("[REDACTED:BEARER_TOKEN]");

    const blockers = getUnreadBlockerPreviews("bob", { limit: 99_999, max_bytes: 1_024 });
    expect(blockers.messages.map((message) => message.id)).toEqual([blocker.id]);
    expect(blockers.messages[0]).not.toHaveProperty("content");
    expect(blockers.byte_length).toBeLessThanOrEqual(1_024);
    expect(getMessageById(normal.id)?.read_at).toBeNull();
    expect(getMessageById(blocker.id)?.read_at).toBeNull();
    expect(getReadReceipts(blocker.id)).toEqual([]);
  });

  test("malformed byte and time limits fail closed", () => {
    expect(() => resolveCollectionMaxBytes("not-a-number")).toThrow("max_bytes");
    expect(() => resolveCollectionMaxBytes(1)).toThrow("max_bytes");
    expect(() => resolveCollectionTimeoutMs("later")).toThrow("timeout_ms");
    expect(() => resolveCollectionTimeoutMs(0)).toThrow("timeout_ms");
  });
});
