import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { closeDb, getDb, getDataDir } from "../lib/db.js";
import { readMessages, sendMessage } from "../lib/messages.js";
import { createChannel } from "../lib/channels.js";
import { readChannelNotifications, subscribeToChannelNotifications } from "../lib/channel-notifications.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerChannelBridge, setSessionAgent, setClaudeSessionId, getSessionAgent, getClaudeSessionId } from "./channel.js";
import { ENV_KEYS, getStore } from "../lib/store/index.js";

function createTestDbPath(): string {
  return join(tmpdir(), `conversations-channel-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

function syntheticDatabaseUrl(): string {
  return ["postgres", "://", "bridge_user:synthetic-password", "@db.example.invalid/app"].join("");
}

function insertLegacyChannelMessage(channel: string, content: string): number {
  const result = getDb().prepare(`
    INSERT INTO messages (session_id, from_agent, to_agent, channel, content)
    VALUES (?, ?, ?, ?, ?)
  `).run(`channel:${channel}`, "legacy-sender", channel, channel, content);
  return Number(result.lastInsertRowid);
}

async function waitFor(check: () => boolean, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await Bun.sleep(20);
  }
  throw new Error("Timed out waiting for channel bridge condition");
}

afterEach(() => {
  closeDb();
  const dbPath = process.env.CONVERSATIONS_DB_PATH;
  if (dbPath) {
    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(dbPath + "-wal"); } catch {}
    try { unlinkSync(dbPath + "-shm"); } catch {}
    delete process.env.CONVERSATIONS_DB_PATH;
  }
});

describe("channel bridge delivery", () => {
  test("retries channel blurbs after a transient transport failure and only clears after delivery", async () => {
    process.env.CONVERSATIONS_DB_PATH = createTestDbPath();
    closeDb();

    createChannel("notify-bridge", "creator");
    subscribeToChannelNotifications("notify-bridge", "watcher", { preview_chars: 24 });

    let allowDelivery = false;
    let attempts = 0;
    const delivered: Array<{ method: string; params: any }> = [];
    // Session state is keyed by the server, so the bridge and setSessionAgent
    // must be handed the same instance.
    const bridgeServer = {
      server: {
        registerCapabilities() {},
        async notification(payload: { method: string; params: any }) {
          attempts += 1;
          if (!allowDelivery) throw new Error("transport unavailable");
          delivered.push(payload);
        },
      },
    } as any;
    setSessionAgent(bridgeServer, "watcher", "claude-session-channel");
    const stop = registerChannelBridge(bridgeServer, {
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

  test("channel blurbs redact legacy sensitive notification previews", async () => {
    const blocked = syntheticDatabaseUrl();
    process.env.CONVERSATIONS_DB_PATH = createTestDbPath();
    closeDb();

    createChannel("notify-bridge-redact", "creator");
    subscribeToChannelNotifications("notify-bridge-redact", "watcher", { preview_chars: 120 });

    const delivered: Array<{ method: string; params: any }> = [];
    const bridgeServer = {
      server: {
        registerCapabilities() {},
        async notification(payload: { method: string; params: any }) {
          delivered.push(payload);
        },
      },
    } as any;
    setSessionAgent(bridgeServer, "watcher", "claude-session-channel-redact");
    const stop = registerChannelBridge(bridgeServer, {
      pollIntervalMs: 20,
      startDelayMs: 0,
    });

    try {
      insertLegacyChannelMessage("notify-bridge-redact", `legacy ${blocked}`);
      await waitFor(() => delivered.length === 1);

      expect(delivered[0].params.content).toContain("[REDACTED:DATABASE URL]");
      expect(delivered[0].params.content).not.toContain(blocked);
    } finally {
      stop();
    }
  });

  test("retries direct session deliveries after a transient transport failure", async () => {
    process.env.CONVERSATIONS_DB_PATH = createTestDbPath();
    closeDb();

    let allowDelivery = false;
    let attempts = 0;
    const delivered: Array<{ method: string; params: any }> = [];
    const bridgeServer = {
      server: {
        registerCapabilities() {},
        async notification(payload: { method: string; params: any }) {
          attempts += 1;
          if (!allowDelivery) throw new Error("transport unavailable");
          delivered.push(payload);
        },
      },
    } as any;
    setSessionAgent(bridgeServer, "watcher", "claude-session-direct");
    const stop = registerChannelBridge(bridgeServer, {
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
  let connection: McpServer;

  beforeEach(() => {
    connection = new McpServer({ name: "test-session-tracking", version: "0.0.1" });
    delete process.env.CONVERSATIONS_AGENT_ID;
    delete process.env.CONVERSATIONS_SESSION_ID;
  });

  test("setSessionAgent stores agent id", () => {
    setSessionAgent(connection, "test-agent");
    expect(getSessionAgent(connection)).toBe("test-agent");
  });

  test("one connection's agent is invisible to another connection on the same process", () => {
    // Regression: this state used to be a module-level global, so on the default
    // Streamable HTTP transport ("one process per MCP, many agents") the last
    // agent to register became the implicit author for every other client on the
    // box — one agent's messages filed under another agent's name.
    const other = new McpServer({ name: "test-session-tracking-other", version: "0.0.1" });

    setSessionAgent(connection, "alpha-agent");
    setSessionAgent(other, "beta-agent");

    expect(getSessionAgent(connection)).toBe("alpha-agent");
    expect(getSessionAgent(other)).toBe("beta-agent");
  });

  test("setSessionAgent does NOT write the installation-wide identity file", () => {
    // Regression: the MCP server is one long-lived daemon under a single HOME,
    // shared by every client session on the machine. When setSessionAgent wrote
    // the agent-id file, ANY heartbeat naming ANY agent silently re-stamped the
    // whole machine's identity — including this very test suite, whose
    // "rename-old" fixture (src/mcp/tools/agents.test.ts) repeatedly hijacked
    // station01's identity just by running `bun test`.
    const agentIdFile = join(getDataDir(), "agent-id");

    let before: string | null;
    try {
      before = readFileSync(agentIdFile, "utf-8");
    } catch {
      before = null;
    }

    setSessionAgent(connection, "identity-hijack-canary");

    let after: string | null;
    try {
      after = readFileSync(agentIdFile, "utf-8");
    } catch {
      after = null;
    }

    expect(after).toBe(before);
    expect(after ?? "").not.toContain("identity-hijack-canary");
    // In-memory session tracking must still work.
    expect(getSessionAgent(connection)).toBe("identity-hijack-canary");
  });

  test("setSessionAgent stores claude session id", () => {
    setSessionAgent(connection, "test-agent", "session-123");
    expect(getSessionAgent(connection)).toBe("test-agent");
    expect(getClaudeSessionId(connection)).toBe("session-123");
  });

  test("setClaudeSessionId stores session id", () => {
    setClaudeSessionId(connection, "my-session");
    expect(getClaudeSessionId(connection)).toBe("my-session");
  });

  test("getSessionAgent falls back to env var", () => {
    process.env.CONVERSATIONS_AGENT_ID = "env-agent";
    expect(getSessionAgent(connection)).toBe("env-agent");
  });

  test("getClaudeSessionId falls back to env var", () => {
    process.env.CONVERSATIONS_SESSION_ID = "env-session";
    expect(getClaudeSessionId(connection)).toBe("env-session");
  });

  test("returns null when nothing set", () => {
    expect(getSessionAgent(connection)).toBeNull();
  });

  test("registerChannelBridge returns cleanup function", () => {
    const server = new McpServer({ name: "test-channel-cleanup", version: "0.0.1" });
    const cleanup = registerChannelBridge(server, { pollIntervalMs: 50000, startDelayMs: 50000 });
    expect(typeof cleanup).toBe("function");
    cleanup();
  });
});

/**
 * Regression for the MCP channel bridge's swallowed poll failure
 * (todos d3c6b65e), site C.
 *
 * On base both call sites read `void pollOnce().catch(() => { });` — an
 * explicitly empty handler. Unlike the CLI loops there is no process-level
 * unhandledRejection handler in an MCP server, so a store outage produced
 * NOTHING: the bridge kept ticking and the session could not distinguish a
 * broken bridge from a quiet inbox. This is the site with live processes
 * behind it.
 *
 * The failure is a real ApiStore aimed at a closed port, so the rejection
 * comes from the transport the fleet actually runs.
 */
describe("channel bridge — store failure visibility (regression d3c6b65e)", () => {
  test("reports a store failure instead of swallowing it", async () => {
    // A store built from a PRIVATE env object, never from process.env. The
    // earlier version flipped the cloud keys process-wide, and
    // getStore(env = process.env) re-reads them per call without caching — so
    // every other live bridge in the run adopted this closed port too,
    // including the ones buildServer() starts and never disposes
    // (todos 890b269e), whose retrying reads then landed in a later file's
    // global fetch stub (todos 19c79404). Handing the store to this ONE bridge
    // keeps the real transport and the real fetch while touching nothing
    // global. Port 9 (discard) is closed here: connect fails immediately.
    const failingStore = getStore({
      [ENV_KEYS.apiUrlKeys[0]]: "http://127.0.0.1:9/v1",
      [ENV_KEYS.apiKeyKeys[0]]: "placeholder-not-a-credential",
    });

    const lines: string[] = [];
    const bridgeServer = {
      server: {
        registerCapabilities() {},
        async notification() {},
      },
    } as any;
    setSessionAgent(bridgeServer, "watcher", "claude-session-store-failure");

    const stop = registerChannelBridge(bridgeServer, {
      store: failingStore,
      pollIntervalMs: 50,
      startDelayMs: 0,
      onPollError: (line: string) => { lines.push(line); },
    });

    try {
      // A failed ApiStore read takes ~760ms (the storage client retries), so
      // this waits well past one attempt rather than one poll interval.
      await waitFor(() => lines.length > 0, 8000);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("\n")).toMatch(/unable to connect|refused|failed|ConnectionRefused/i);
    } finally {
      // Awaited: the disposer resolves only once the poll that was already
      // retrying has drained. Left un-awaited it kept calling the global fetch
      // after this test returned, landing in a later file's stub and failing an
      // assertion there — which is what turned main red (todos 19c79404).
      await stop();
    }
  }, 20000);

  /**
   * NO DRAIN TEST HERE, DELIBERATELY — and this note is the reason, so nobody
   * adds one and watches it flake.
   *
   * The bridge's disposer does now drain (src/mcp/channel.ts), and that is what
   * fixed main. But the property cannot be ASSERTED from this suite yet.
   * `pollOnce` resolves `getStore()` on every poll, and `getStore(env =
   * process.env)` re-reads the environment each call and does not cache — so a
   * probe that points the store at a unique closed host to count only its own
   * traffic has that host adopted by every other live bridge in the process.
   *
   * There are three such bridges: `buildServer()` (src/mcp/index.ts:62) starts
   * one and returns only the McpServer, so its disposer is unreachable by
   * construction, and tool-contract.test.ts:171, http.test.ts:224 and
   * envelope-ordering.test.ts:114 each leak one for the rest of the run.
   * Measured on the full suite: a drain probe on its own unique host still
   * counted `Expected: 0 / Received: 8`, with zero foreign URLs logged — all of
   * it from those bridges wearing this test's store URL.
   *
   * Tracked as todos 890b269e. Once buildServer exposes its disposer this test
   * becomes writable; the equivalent assertion for the `watch` loop lives in
   * src/lib/poll.test.ts, which CAN isolate because startPolling resolves its
   * store once at construction.
   */
});
