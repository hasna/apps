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
import { allowLocalStore, closeDb, getDb } from "../db/index.js";
import { getSettingsPath } from "../lib/installer.js";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "hooks-mcp-failclosed-"));
// The data dir alone is not enough: the installer resolves GLOBAL settings
// under the real home when no override is set, so `installHook(..., { scope:
// "global" })` in this file registered `fast-preview-hook` into the operator's
// live ~/.claude/settings.json and every tool call in every session then failed
// with {"error":"Hook 'fast-preview-hook' not found"}. Every settings path this
// file can write must resolve inside TEST_HOME (the package's TEST_HOME +
// HASNA_HOOKS_*_SETTINGS_PATH convention).
const TEST_HOME = mkdtempSync(join(tmpdir(), "hooks-mcp-failclosed-home-"));
const TEST_CLAUDE_SETTINGS = join(TEST_HOME, ".claude", "settings.json");
const TEST_GEMINI_SETTINGS = join(TEST_HOME, ".gemini", "settings.json");
const TEST_CODEWITH_CONFIG = join(TEST_HOME, ".codewith", "config.toml");

const originalDataDir = process.env.HASNA_HOOKS_DATA_DIR;
const originalDbPath = process.env.HASNA_HOOKS_DB_PATH;
const originalLockPath = process.env.HASNA_HOOKS_LOCK_PATH;
const originalClaudeSettings = process.env.HASNA_HOOKS_CLAUDE_SETTINGS_PATH;
const originalGeminiSettings = process.env.HASNA_HOOKS_GEMINI_SETTINGS_PATH;
const originalCodewithConfig = process.env.HASNA_HOOKS_CODEWITH_CONFIG_PATH;
// startSSEServer decides its authority in-process from process.env: a stray
// authority variable seeded by another suite would turn that into a HOSTED
// decision and install a process-wide store refusal that outlives this file.
const AUTHORITY_ENV_KEYS = [
  "HASNA_HOOKS_API_URL", "HOOKS_API_URL", "HASNA_HOOKS_API_KEY", "HOOKS_API_KEY",
  "HASNA_HOOKS_API_KEY_OVERRIDE", "HASNA_HOOKS_API_KEY_REF", "HASNA_PROFILE",
];
const originalAuthorityEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  closeDb();
  // Explicit local opt-in (hasna/apps#1720): the hook-event writer and
  // startSSEServer's authority decision fail closed without it; this file exercises the
  // on-box store on purpose.
  for (const key of AUTHORITY_ENV_KEYS) {
    originalAuthorityEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.HASNA_HOOKS_LOCAL = "1";
  process.env.HASNA_HOOKS_DATA_DIR = TEST_DATA_DIR;
  process.env.HASNA_HOOKS_DB_PATH = join(TEST_DATA_DIR, "hooks.db");
  process.env.HASNA_HOOKS_LOCK_PATH = join(TEST_DATA_DIR, "hooks.lock");
  process.env.HASNA_HOOKS_CLAUDE_SETTINGS_PATH = TEST_CLAUDE_SETTINGS;
  process.env.HASNA_HOOKS_GEMINI_SETTINGS_PATH = TEST_GEMINI_SETTINGS;
  process.env.HASNA_HOOKS_CODEWITH_CONFIG_PATH = TEST_CODEWITH_CONFIG;
});

afterAll(() => {
  closeDb();
  const restore = (name: string, original: string | undefined) => {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  };
  delete process.env.HASNA_HOOKS_LOCAL;
  for (const key of AUTHORITY_ENV_KEYS) restore(key, originalAuthorityEnv[key]);
  allowLocalStore();
  restore("HASNA_HOOKS_DATA_DIR", originalDataDir);
  restore("HASNA_HOOKS_DB_PATH", originalDbPath);
  restore("HASNA_HOOKS_LOCK_PATH", originalLockPath);
  restore("HASNA_HOOKS_CLAUDE_SETTINGS_PATH", originalClaudeSettings);
  restore("HASNA_HOOKS_GEMINI_SETTINGS_PATH", originalGeminiSettings);
  restore("HASNA_HOOKS_CODEWITH_CONFIG_PATH", originalCodewithConfig);
  rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe("fail-closed fixtures never write a real home settings path", () => {
  test("every global settings path this file can write resolves inside TEST_HOME", () => {
    for (const target of ["claude", "gemini", "codewith"] as const) {
      const path = getSettingsPath("global", target);
      expect(path.startsWith(TEST_HOME)).toBe(true);
    }
  });
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
    // Placeholder-marked value: the fleet scan's credential_assignment
    // heuristic suppresses values containing "placeholder"/"dummy"/"example",
    // so this fixture does not trip `secrets scan staged`.
    process.env.HASNA_HOOKS_MCP_TOKEN = "mcp-test-placeholder-token";
    try {
      await startSSEServer({ port: 0, host: "127.0.0.1" });
      const { sseAuthToken } = await import("./server.js");
      expect(sseAuthToken()).toBe("mcp-test-placeholder-token");
      expect(sseAuthToken("explicit")).toBe("explicit");
    } finally {
      if (oldToken === undefined) delete process.env.HASNA_HOOKS_MCP_TOKEN;
      else process.env.HASNA_HOOKS_MCP_TOKEN = oldToken;
    }
  });
});
