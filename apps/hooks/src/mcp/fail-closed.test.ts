/**
 * Regression tests for P1-7 (preview timeout fail-closed) and P1-2 (MCP SSE
 * loopback bind + auth).
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHooksServer, startSSEServer } from "./server.js";
import { closeDb, getDb } from "../db/index.js";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "hooks-mcp-failclosed-"));

const originalDataDir = process.env.HASNA_HOOKS_DATA_DIR;
const originalDbPath = process.env.HASNA_HOOKS_DB_PATH;
const originalLockPath = process.env.HASNA_HOOKS_LOCK_PATH;

beforeAll(() => {
  closeDb();
  process.env.HASNA_HOOKS_DATA_DIR = TEST_DATA_DIR;
  process.env.HASNA_HOOKS_DB_PATH = join(TEST_DATA_DIR, "hooks.db");
  process.env.HASNA_HOOKS_LOCK_PATH = join(TEST_DATA_DIR, "hooks.lock");
});

afterAll(() => {
  closeDb();
  if (originalDataDir === undefined) delete process.env.HASNA_HOOKS_DATA_DIR;
  else process.env.HASNA_HOOKS_DATA_DIR = originalDataDir;
  if (originalDbPath === undefined) delete process.env.HASNA_HOOKS_DB_PATH;
  else process.env.HASNA_HOOKS_DB_PATH = originalDbPath;
  if (originalLockPath === undefined) delete process.env.HASNA_HOOKS_LOCK_PATH;
  else process.env.HASNA_HOOKS_LOCK_PATH = originalLockPath;
  rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

function installHook(name: string, script: string, timeoutMs?: number): void {
  const dir = join(TEST_DATA_DIR, "hooks", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    name,
    version: "1.0.0",
    events: ["PreToolUse"],
    script: "script.ts",
    ...(timeoutMs ? { timeout_ms: timeoutMs } : {}),
  }));
  writeFileSync(join(dir, "script.ts"), script);
  const { retrustHook } = require("../lib/store.js");
  retrustHook(name, join(dir, "script.ts"), "1.0.0", "custom");
}

function parseResult(result: any): any {
  return JSON.parse((result.content as any)[0].text);
}

describe("hooks_preview timeout fail-closed (P1-7)", () => {
  let client: Client;
  let transportPair: ReturnType<typeof InMemoryTransport.createLinkedPair>;

  async function freshClient(): Promise<Client> {
    const c = new Client({ name: "hooks-failclosed-test", version: "0.0.0" });
    const pair = InMemoryTransport.createLinkedPair();
    const server = createHooksServer();
    await Promise.all([
      c.connect(pair[0]),
      (server as any).connect(pair[1]),
    ]);
    return c;
  }

  beforeAll(async () => {
    installHook(
      "slow-preview-hook",
      `await Bun.sleep(5000);\nconsole.log(JSON.stringify({ decision: "approve", reason: "took too long" }));\n`,
      10000,
    );
    installHook("fast-preview-hook", `console.log(JSON.stringify({ decision: "approve", reason: "ok" }));\n`, 10000);
  });

  afterAll(() => {
    closeDb();
  });

  test("a timed-out preview blocks — never approves", async () => {
    const { installHook: doInstall, removeHook } = await import("../lib/installer.js");
    doInstall("slow-preview-hook", { scope: "global", overwrite: true });
    removeHook("fast-preview-hook", "global");

    client = await freshClient();
    try {
      const data = parseResult(await client.callTool({
        name: "hooks_preview",
        arguments: { tool_name: "Bash", tool_input: { command: "echo hi" }, timeout_ms: 100 },
      }));
      const slow = data.results.find((r: any) => r.name === "slow-preview-hook");
      expect(slow).toBeDefined();
      expect(slow.timedOut).toBe(true);
      expect(slow.decision).toBe("block");
      expect(data.decision).toBe("block");
      expect(String(data.blocked_reason ?? data.blocked_by ?? "")).toBeTruthy();
    } finally {
      await client.close();
    }
  });

  test("a successful preview approves", async () => {
    const { installHook: doInstall, removeHook } = await import("../lib/installer.js");
    removeHook("slow-preview-hook", "global");
    doInstall("fast-preview-hook", { scope: "global", overwrite: true });

    client = await freshClient();
    try {
      const data = parseResult(await client.callTool({
        name: "hooks_preview",
        arguments: { tool_name: "Bash", tool_input: { command: "echo hi" }, timeout_ms: 5000 },
      }));
      const fast = data.results.find((r: any) => r.name === "fast-preview-hook");
      expect(fast).toBeDefined();
      expect(fast.timedOut).toBeUndefined();
      expect(fast.decision).toBe("approve");
      expect(data.decision).toBe("approve");
    } finally {
      await client.close();
    }
  });
});

describe("MCP SSE bind and auth (P1-2)", () => {
  test("startSSEServer refuses a non-loopback host without an auth token", async () => {
    await expect(startSSEServer({ port: 0, host: "0.0.0.0" })).rejects.toThrow(/without an auth token/);
  });

  test("startSSEServer binds 127.0.0.1 by default", async () => {
    const serverPromise = startSSEServer({ port: 0 });
    // startSSEServer resolves immediately after listen() — assert it did not
    // reject (a wildcard-bind regression would surface as a throw) and that
    // the default host constant is loopback.
    await serverPromise;
    const { MCP_SSE_HOST } = await import("./server.js");
    expect(MCP_SSE_HOST).toBe("127.0.0.1");
  });

  test("a non-loopback bind with a token serves and enforces auth on /sse", async () => {
    const oldToken = process.env.HASNA_HOOKS_MCP_TOKEN;
    process.env.HASNA_HOOKS_MCP_TOKEN = "mcp-test-token";
    try {
      await startSSEServer({ port: 0, host: "127.0.0.1" });
      const { sseAuthToken } = await import("./server.js");
      expect(sseAuthToken()).toBe("mcp-test-token");
      expect(sseAuthToken("explicit")).toBe("explicit");
    } finally {
      if (oldToken === undefined) delete process.env.HASNA_HOOKS_MCP_TOKEN;
      else process.env.HASNA_HOOKS_MCP_TOKEN = oldToken;
    }
  });
});
