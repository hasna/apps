import { describe, test, expect } from "bun:test";
import * as index from "./index";

// The public SDK surface is the Store abstraction + domain types (see the module
// header in index.ts). The raw sqlite-bound helpers and getDb handle are NOT
// exported — that was the split-brain bug. These tests pin the new surface.

describe("public API exports", () => {
  test("exports the Store resolver and implementations", () => {
    expect(typeof index.getStore).toBe("function");
    expect(typeof index.LocalStore).toBe("function");
  });

  test("exports the transport resolvers", () => {
    expect(typeof index.isCloudStore).toBe("function");
    expect(typeof index.cloudApiUrl).toBe("function");
    expect(typeof index.resolveConversationsCloud).toBe("function");
    expect(typeof index.conversationsCloudEnv).toBe("function");
    expect(typeof index.normalizeChannelName).toBe("function");
  });

  test("exports the store-routed project panel", () => {
    expect(typeof index.createConversationsProjectPanel).toBe("function");
  });

  test("does NOT re-export raw sqlite-bound helpers or the db handle", () => {
    // These leaked the LocalStore path to SDK callers regardless of the flip.
    expect((index as Record<string, unknown>).getDb).toBeUndefined();
    expect((index as Record<string, unknown>).sendMessage).toBeUndefined();
    expect((index as Record<string, unknown>).readMessages).toBeUndefined();
    expect((index as Record<string, unknown>).markRead).toBeUndefined();
    expect((index as Record<string, unknown>).startPolling).toBeUndefined();
  });

  test("every read/write goes through a Store instance under an explicit store env", () => {
    const store = index.getStore({ HASNA_CONVERSATIONS_DB_PATH: "/tmp/conversations-index-test.db" });
    expect(store.transport).toBe("local");
    expect(typeof store.sendMessage).toBe("function");
    expect(typeof store.readMessages).toBe("function");
    expect(typeof store.countMessages).toBe("function");
    expect(typeof store.markRead).toBe("function");
    expect(typeof store.createChannel).toBe("function");
    expect(typeof store.createProject).toBe("function");
    expect(typeof store.createTask).toBe("function");
    expect(typeof store.acquireLock).toBe("function");
  });

  test("an env with no API credentials and no store path fails closed", () => {
    // Fail-closed ruling 2026-09-04: the SDK must refuse — naming the required
    // env vars — rather than bind to the on-box SQLite store at its default path.
    expect(() => index.getStore({})).toThrow("HASNA_CONVERSATIONS_API_URL");
    expect(() => index.getStore({})).toThrow("HASNA_CONVERSATIONS_API_KEY");
  });
});
