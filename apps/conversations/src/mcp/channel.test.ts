import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { closeDb } from "../lib/db.js";
import { readMessages, sendMessage } from "../lib/messages.js";
import { createChannel } from "../lib/channels.js";
import { readChannelNotifications, subscribeToChannelNotifications } from "../lib/channel-notifications.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerChannelBridge, setSessionAgent, setClaudeSessionId, getSessionAgent, getClaudeSessionId } from "./channel.js";
import { enterHermeticTestEnv, installNetworkGuard } from "../test/hermetic.js";

let restoreEnv: () => void;
let restoreNetwork: () => void;

function createTestDbPath(): string {
  return join(tmpdir(), `conversations-channel-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

async function waitFor(check: () => boolean, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await Bun.sleep(20);
  }
  throw new Error("Timed out waiting for channel bridge condition");
}

beforeEach(() => {
  restoreEnv = enterHermeticTestEnv();
  restoreNetwork = installNetworkGuard();
});

afterEach(() => {
  closeDb();
  const dbPath = process.env.CONVERSATIONS_DB_PATH;
  if (dbPath) {
    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(dbPath + "-wal"); } catch {}
    try { unlinkSync(dbPath + "-shm"); } catch {}
    delete process.env.CONVERSATIONS_DB_PATH;
  }
  restoreNetwork();
  restoreEnv();
});

describe("channel bridge delivery", () => {
  test("retries channel blurbs after a transient transport failure and only clears after delivery", async () => {
    process.env.CONVERSATIONS_DB_PATH = createTestDbPath();
    closeDb();

    createChannel("notify-bridge", "creator");
    subscribeToChannelNotifications("notify-bridge", "watcher", { preview_chars: 24 });
    setSessionAgent("watcher", "claude-session-channel");

    let allowDelivery = false;
    let attempts = 0;
    const delivered: Array<{ method: string; params: any }> = [];
    const stop = registerChannelBridge({
      server: {
        registerCapabilities() {},
        async notification(payload: { method: string; params: any }) {
          attempts += 1;
          if (!allowDelivery) throw new Error("transport unavailable");
          delivered.push(payload);
        },
      },
    } as any, {
      pollIntervalMs: 20,
      startDelayMs: 0,
    });

    try {
      sendMessage({
        from: "alice",
        to: "notify-bridge",
        channel: "notify-bridge",
        session_id: "channel:notify-bridge",
        content: "Deployment status update after rollout completed",
      });

      await waitFor(() => attempts >= 1);
      expect(readChannelNotifications({ agent: "watcher", unread_only: true })).toHaveLength(1);
      expect(delivered).toHaveLength(0);

      allowDelivery = true;
      await waitFor(() => delivered.length === 1);

      expect(delivered[0].method).toBe("notifications/claude/channel");
      expect(delivered[0].params.meta.mode).toBe("channel_blurb");
      expect(delivered[0].params.meta.channel).toBe("notify-bridge");
      expect(delivered[0].params.content).toContain("alice posted in #notify-bridge");
      expect(delivered[0].params.content).toContain("Preview only for channel message");
      expect(readChannelNotifications({ agent: "watcher", unread_only: true })).toHaveLength(0);
    } finally {
      stop();
    }
  });

  test("retries direct session deliveries after a transient transport failure", async () => {
    process.env.CONVERSATIONS_DB_PATH = createTestDbPath();
    closeDb();

    setSessionAgent("watcher", "claude-session-direct");

    let allowDelivery = false;
    let attempts = 0;
    const delivered: Array<{ method: string; params: any }> = [];
    const stop = registerChannelBridge({
      server: {
        registerCapabilities() {},
        async notification(payload: { method: string; params: any }) {
          attempts += 1;
          if (!allowDelivery) throw new Error("transport unavailable");
          delivered.push(payload);
        },
      },
    } as any, {
      pollIntervalMs: 20,
      startDelayMs: 0,
    });

    try {
      const message = sendMessage({
        from: "alice",
        to: "session:claude-session-direct",
        session_id: "alice-session",
        content: "Direct session note",
      });

      await waitFor(() => attempts >= 1);
      expect(readMessages({ to: "session:claude-session-direct", unread_only: true })).toHaveLength(1);
      expect(delivered).toHaveLength(0);

      allowDelivery = true;
      await waitFor(() => delivered.length === 1);

      expect(delivered[0].method).toBe("notifications/claude/channel");
      expect(delivered[0].params.meta.mode).toBe("direct");
      expect(delivered[0].params.meta.message_id).toBe(String(message.id));
      expect(readMessages({ to: "session:claude-session-direct", unread_only: true })).toHaveLength(0);
    } finally {
      stop();
    }
  });
});

describe("session agent tracking", () => {
  beforeEach(() => {
    setSessionAgent("");
    setClaudeSessionId("");
    delete process.env.CONVERSATIONS_AGENT_ID;
    delete process.env.CONVERSATIONS_SESSION_ID;
  });

  test("setSessionAgent stores agent id", () => {
    setSessionAgent("test-agent");
    expect(getSessionAgent()).toBe("test-agent");
  });

  test("setSessionAgent stores claude session id", () => {
    setSessionAgent("test-agent", "session-123");
    expect(getSessionAgent()).toBe("test-agent");
    expect(getClaudeSessionId()).toBe("session-123");
  });

  test("setClaudeSessionId stores session id", () => {
    setClaudeSessionId("my-session");
    expect(getClaudeSessionId()).toBe("my-session");
  });

  test("getSessionAgent falls back to env var", () => {
    process.env.CONVERSATIONS_AGENT_ID = "env-agent";
    expect(getSessionAgent()).toBe("env-agent");
  });

  test("getClaudeSessionId falls back to env var", () => {
    process.env.CONVERSATIONS_SESSION_ID = "env-session";
    expect(getClaudeSessionId()).toBe("env-session");
  });

  test("returns null when nothing set", () => {
    setSessionAgent("");
    expect(getSessionAgent()).toBeNull();
  });

  test("registerChannelBridge returns cleanup function", () => {
    const server = new McpServer({ name: "test-channel-cleanup", version: "0.0.1" });
    const cleanup = registerChannelBridge(server, { pollIntervalMs: 50000, startDelayMs: 50000 });
    expect(typeof cleanup).toBe("function");
    cleanup();
  });
});
