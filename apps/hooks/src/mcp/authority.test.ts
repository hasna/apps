/**
 * `hooks-mcp` fail-closed startup (hasna/apps#1720 ruling; todos #1942
 * pattern). The bin decides its authority BEFORE the stdio transport
 * connects: with nothing configured it exits 1 without answering
 * `initialize` and creates no local file; under the explicit local opt-in it
 * serves and says "LOCAL mode" on stderr; on the hosted route it serves but
 * every local-only tool refuses with REMOTE_COMMAND_UNSUPPORTED instead of
 * answering from an empty hooks.db.
 *
 * Spawns the real bin entry (src/mcp/hooks-mcp.ts) in a scrubbed
 * environment: HASNA_STATION=no-such-station keeps the station's real
 * Keychain item out of the run (a Keychain hit would be a hosted route, not
 * "nothing configured").
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { unavailableEventServer } from "../test/unavailable-event-server.js";

const BIN = join(import.meta.dir, "hooks-mcp.ts");

const TRANSPORT_ENV_KEYS = [
  "HASNA_HOOKS_API_URL",
  "HOOKS_API_URL",
  "HASNA_HOOKS_API_KEY",
  "HOOKS_API_KEY",
  "HASNA_HOOKS_API_KEY_OVERRIDE",
  "HASNA_HOOKS_API_KEY_REF",
  "HASNA_PROFILE",
  "HASNA_HOOKS_LOCAL",
  "HOOKS_LOCAL",
];

const roots: string[] = [];
const eventServers: ReturnType<typeof unavailableEventServer>[] = [];
afterEach(() => {
  for (const endpoint of eventServers.splice(0)) endpoint.server.stop(true);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sandboxEnv(): { env: Record<string, string>; root: string; dataDir: string } {
  const root = mkdtempSync(join(tmpdir(), "hooks-mcp-authority-"));
  roots.push(root);
  const dataDir = join(root, "data");
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of TRANSPORT_ENV_KEYS) delete env[key];
  env.HOME = join(root, "home");
  env.HASNA_STATION = "no-such-station";
  env.HASNA_HOOKS_DATA_DIR = dataDir;
  env.HASNA_HOOKS_DB_PATH = join(dataDir, "hooks.db");
  env.HASNA_HOOKS_LOCK_PATH = join(dataDir, "hooks.lock");
  env.HASNA_HOOKS_CLAUDE_SETTINGS_PATH = join(root, "home", ".claude", "settings.json");
  env.NO_COLOR = "1";
  return { env, root, dataDir };
}

async function connect(env: Record<string, string>): Promise<{ client: Client; stderr: () => string; close: () => Promise<void> }> {
  const transport = new StdioClientTransport({ command: "bun", args: ["run", BIN], env, stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const client = new Client({ name: "hooks-mcp-authority-test", version: "0.0.0" });
  await client.connect(transport);
  return { client, stderr: () => stderr, close: () => client.close() };
}

describe("hooks-mcp decides authority before the transport connects", () => {
  test("nothing configured: exits 1 with the one-line diagnostic BEFORE initialize; creates no local file", async () => {
    const { env, dataDir, root } = sandboxEnv();
    const proc = Bun.spawn(["bun", "run", BIN], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
    ]);
    const exitCode = await proc.exited;
    expect(exitCode).toBe(1);
    // No JSON-RPC frame was ever written: initialize was not answered.
    expect(stdout.trim()).toBe("");
    const firstLine = stderr.split("\n").find((line) => line.trim() !== "") ?? "";
    expect(firstLine).toMatch(/^REMOTE_API_(CONFIG_MISSING|KEY_MISSING|CREDENTIAL_INVALID)/);
    expect(firstLine).toContain("hasna.credentials.hooks.api-key");
    expect(firstLine).toContain("~/.hasna/hooks/config/credentials");
    expect(firstLine).toContain("HASNA_HOOKS_API_KEY");
    expect(firstLine).toContain("HASNA_HOOKS_LOCAL=1");
    expect(existsSync(dataDir)).toBe(false);
    expect(existsSync(join(root, "home", ".hasna"))).toBe(false);
  }, 30_000);

  test("explicit local opt-in: serves, says LOCAL mode on stderr, and log tools read the on-box store", async () => {
    const { env, dataDir } = sandboxEnv();
    env.HASNA_HOOKS_LOCAL = "1";
    const session = await connect(env);
    try {
      const tools = await session.client.listTools();
      expect(tools.tools.map((t) => t.name)).toContain("hooks_log_tail");
      const result: any = await session.client.callTool({ name: "hooks_log_tail", arguments: { n: 5 } });
      expect(result.isError ?? false).toBe(false);
      const payload = JSON.parse(result.content[0].text);
      expect(payload.count).toBe(0);
      expect(existsSync(join(dataDir, "hooks.db"))).toBe(true);
    } finally {
      await session.close();
    }
    expect(session.stderr()).toContain("hooks: LOCAL mode");
  }, 30_000);

  test("hosted route: unavailable event reads and local-only tools refuse without creating hooks.db", async () => {
    const { env, dataDir } = sandboxEnv();
    const endpoint = unavailableEventServer("mcp-authority-test-placeholder-key");
    eventServers.push(endpoint);
    env.HASNA_HOOKS_API_URL = endpoint.url;
    env.HASNA_HOOKS_API_KEY = "mcp-authority-test-placeholder-key";
    const session = await connect(env);
    try {
      const tail: any = await session.client.callTool({ name: "hooks_log_tail", arguments: { n: 5 } });
      expect(tail.isError).toBe(true);
      expect(tail.content[0].text).toContain("fixture event store unavailable");
      expect(endpoint.requests).toEqual(["GET /api/v1/events"]);
      const status: any = await session.client.callTool({ name: "storage_status", arguments: {} });
      expect(status.isError).toBe(true);
      expect(status.content[0].text).toContain("REMOTE_COMMAND_UNSUPPORTED");
      // Catalog reads do not touch the store and still work on the hosted route.
      const list: any = await session.client.callTool({ name: "hooks_categories", arguments: {} });
      expect(list.isError ?? false).toBe(false);
      expect(existsSync(join(dataDir, "hooks.db"))).toBe(false);
    } finally {
      await session.close();
    }
    expect(session.stderr()).not.toContain("LOCAL mode");
  }, 30_000);
});
