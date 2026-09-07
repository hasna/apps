/**
 * @hasna/logs — MCP fail-closed + no-local-SQLite regression
 * (hasna/apps#1720 validation, owner ruling 2026-09-04).
 *
 * Acceptance pinned here, hermetically (temp HOME / HASNA_HOME / data dir, the
 * HASNA_STATION sentinel so a populated station Keychain is never consulted,
 * every credential env scrubbed):
 *
 *   (c) `logs-mcp` with no resolvable credential exits non-zero BEFORE serving
 *       — `initialize` is never answered — and the first stderr line names
 *       where the credential should live; nothing is created.
 *   (f) a HOSTED `logs-mcp` opens no SQLite file: the agent-lifecycle tools
 *       run on a per-process in-memory registry (and say so), so no
 *       `agent-registry.db` appears under the app home, HASNA_HOME, or the
 *       data dir.
 *   Local mode (explicit HASNA_LOGS_LOCAL=1) keeps the persistent registry —
 *       opened lazily on the first agent tool call, under `$HASNA_HOME/logs`
 *       when HASNA_HOME replaces `~/.hasna`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const entry = fileURLToPath(new URL("./index.ts", import.meta.url));
const repoRoot = join(dirname(entry), "../..");

const INITIALIZE_REQUEST = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "logs-fail-closed-test", version: "0.0.0" },
  },
});

/** Every env name that could configure a transport, a credential, or a path. */
const SCRUBBED = [
  "HASNA_LOGS_API_URL",
  "HASNA_LOGS_API_KEY",
  "LOGS_API_URL",
  "LOGS_API_KEY",
  "HASNA_LOGS_API_KEY_OVERRIDE",
  "HASNA_LOGS_API_KEY_REF",
  "HASNA_PROFILE",
  "HASNA_LOGS_LOCAL",
  "LOGS_LOCAL",
  "HASNA_LOGS_STORAGE_MODE",
  "HASNA_LOGS_MODE",
  "HASNA_LOGS_DATA_DIR",
  "LOGS_DATA_DIR",
  "HASNA_LOGS_DB_PATH",
  "LOGS_DB_PATH",
  "HASNA_AGENT_REGISTRY_DB_PATH",
  "HASNA_CONFIG_HOME",
  "MCP_HTTP_PORT",
];

interface Roots {
  home: string;
  hasnaHome: string;
  dataDir: string;
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoots(label: string): Roots {
  const home = mkdtempSync(join(tmpdir(), `logs-mcp-${label}-home-`));
  const hasnaHome = mkdtempSync(join(tmpdir(), `logs-mcp-${label}-hasna-`));
  const dataDir = join(mkdtempSync(join(tmpdir(), `logs-mcp-${label}-data-`)), "data");
  roots.push(home, hasnaHome, dirname(dataDir));
  return { home, hasnaHome, dataDir };
}

function hermeticEnv(r: Roots, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && !SCRUBBED.includes(key)) env[key] = value;
  }
  return {
    ...env,
    HOME: r.home,
    HASNA_HOME: r.hasnaHome,
    // A Keychain account that exists on no station: the ambient tier misses
    // even where the machine's Keychain carries the real logs key.
    HASNA_STATION: "no-such-station",
    HASNA_LOGS_FSYNC: "0",
    ...extra,
  };
}

function dbFilesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, String(entry.name));
      if (entry.isDirectory()) walk(full);
      else if (/\.(db|sqlite)(-wal|-shm)?$/.test(String(entry.name))) found.push(full);
    }
  };
  walk(dir);
  return found;
}

function allDbFiles(r: Roots): string[] {
  return [...dbFilesUnder(r.home), ...dbFilesUnder(r.hasnaHome), ...dbFilesUnder(dirname(r.dataDir))];
}

function spawnMcp(args: string[], env: Record<string, string>, input?: string) {
  const result = spawnSync("bun", [entry, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    input,
    timeout: 20_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function connect(env: Record<string, string>) {
  const transport = new StdioClientTransport({
    command: "bun",
    args: [entry, "--stdio"],
    env,
    cwd: repoRoot,
  });
  const client = new Client({ name: "logs-fail-closed-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? "";
}

describe("logs-mcp fails closed without a fleet credential", () => {
  test("stdio: exits non-zero before answering initialize, names the remedy first, creates nothing", () => {
    const r = tempRoots("neg-stdio");
    const result = spawnMcp(["--stdio"], hermeticEnv(r), `${INITIALIZE_REQUEST}\n`);

    expect(result.status).not.toBe(0);
    // Never served: no JSON-RPC answer to initialize on stdout.
    expect(result.stdout).toBe("");
    const firstLine = result.stderr.split("\n")[0] ?? "";
    expect(firstLine).toMatch(/hasna\.credentials\.logs\.api-key/);
    expect(firstLine).toMatch(/config\/credentials/);
    expect(firstLine).toMatch(/HASNA_LOGS_API_KEY/);
    expect(firstLine).toMatch(/HASNA_LOGS_LOCAL/);
    // A refusal, not a crash: no stack frames.
    expect(result.stderr).not.toMatch(/\n\s+at /);
    expect(result.stderr).not.toMatch(/^\s*\d+ \|/m);
    expect(allDbFiles(r)).toEqual([]);
    expect(existsSync(r.dataDir)).toBe(false);
    expect(existsSync(join(r.hasnaHome, "logs"))).toBe(false);
    expect(existsSync(join(r.home, ".hasna"))).toBe(false);
  });

  test("http: the startup gate refuses before the listener is created", () => {
    const r = tempRoots("neg-http");
    const result = spawnMcp(["--http", "--port", "65533"], hermeticEnv(r));

    expect(result.status).not.toBe(0);
    expect(result.stderr.split("\n")[0] ?? "").toMatch(/hasna\.credentials\.logs\.api-key/);
    expect(result.stderr).not.toMatch(/listening|http:\/\/127\.0\.0\.1/i);
    expect(allDbFiles(r)).toEqual([]);
  });
});

describe("hosted logs-mcp opens no local SQLite", () => {
  test("agent tools run on a per-process in-memory registry; no agent-registry.db anywhere", async () => {
    const r = tempRoots("hosted");
    const env = hermeticEnv(r, {
      HASNA_LOGS_API_URL: "http://127.0.0.1:1/v1",
      HASNA_LOGS_API_KEY: "logs-test-key-not-a-secret",
    });
    const { client, transport } = await connect(env);
    try {
      const tools = await client.listTools();
      const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));
      expect(byName.has("register_agent")).toBe(true);
      expect(byName.has("list_agents")).toBe(true);
      // The hosted registry says what it is.
      expect(byName.get("register_agent")?.description ?? "").toMatch(/in memory, per process/);
      expect(byName.get("list_agents")?.description ?? "").toMatch(/in memory, per process/);

      const registered = await client.callTool({
        name: "register_agent",
        arguments: { name: "fixer-r1", session_id: "s-1" },
      });
      expect(registered.isError).toBeFalsy();
      expect(JSON.parse(textOf(registered)).name).toBe("fixer-r1");

      const listed = await client.callTool({ name: "list_agents", arguments: {} });
      const agents = JSON.parse(textOf(listed)) as Array<{ name: string }>;
      expect(agents.map((agent) => agent.name)).toContain("fixer-r1");
    } finally {
      await transport.close();
    }

    expect(allDbFiles(r)).toEqual([]);
    expect(existsSync(join(r.home, ".hasna", "logs"))).toBe(false);
    expect(existsSync(join(r.hasnaHome, "logs"))).toBe(false);
    expect(existsSync(r.dataDir)).toBe(false);
  });
});

describe("local opt-in keeps the persistent registry, lazily, under HASNA_HOME", () => {
  test("no registry file at startup; the first agent tool call creates it under $HASNA_HOME/logs", async () => {
    const r = tempRoots("local");
    const env = hermeticEnv(r, { HASNA_LOGS_LOCAL: "1" });
    const registryPath = join(r.hasnaHome, "logs", "agent-registry.db");
    const { client, transport } = await connect(env);
    try {
      const tools = await client.listTools();
      const register = tools.tools.find((tool) => tool.name === "register_agent");
      expect(register?.description ?? "").not.toMatch(/in memory, per process/);
      // Lazy: building the server and listing tools opened nothing.
      expect(existsSync(registryPath)).toBe(false);

      const registered = await client.callTool({
        name: "register_agent",
        arguments: { name: "local-r1" },
      });
      expect(registered.isError).toBeFalsy();
      expect(existsSync(registryPath)).toBe(true);
    } finally {
      await transport.close();
    }

    // HASNA_HOME replaced ~/.hasna: nothing under the temp HOME's dotdir.
    expect(existsSync(join(r.home, ".hasna"))).toBe(false);
    expect(dbFilesUnder(r.home)).toEqual([]);
  });
});
