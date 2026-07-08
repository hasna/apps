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

  test("exports the mode resolvers", () => {
    expect(typeof index.isCloudStore).toBe("function");
    expect(typeof index.cloudApiUrl).toBe("function");
    expect(typeof index.resolveConversationsCloud).toBe("function");
    expect(typeof index.conversationsCloudEnv).toBe("function");
    expect(typeof index.cloudStatus).toBe("function");
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

  test("every read/write goes through a Store instance", () => {
    const store = index.getStore();
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
});
