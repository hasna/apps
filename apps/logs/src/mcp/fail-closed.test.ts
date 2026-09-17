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
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { connect as tcpConnect, createServer as createTcpServer } from "node:net";
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

// ── Streamable HTTP never binds ungated (hasna/apps#1720 validation, round 3) ──
//
// 0.5.0 shipped an HTTP mode that BOUND 127.0.0.1:<port> with no credential
// ("[logs-mcp] Streamable HTTP listening"), stayed alive, and refused every
// session per request (-32603). Acceptance (c) is "non-zero exit BEFORE
// binding in every mode", so these tests look at the socket, not at stderr
// text: a port the test reserved is probed continuously while the child runs
// and must be refused on every probe; an `initialize` POST must never get an
// HTTP answer of any kind.

/** Bind an ephemeral port on loopback, release it, return its number. */
function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createTcpServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** One TCP connect attempt: "open" when something accepted, "refused" otherwise. */
function probePort(port: number): Promise<"open" | "refused"> {
  return new Promise((resolve) => {
    const socket = tcpConnect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve("open");
    });
    socket.once("error", () => resolve("refused"));
  });
}

interface SpawnedMcp {
  exited: Promise<number | null>;
  stdout: () => string;
  stderr: () => string;
  kill: (signal: NodeJS.Signals) => void;
}

/** Spawn logs-mcp detached from the test's stdin and collect its streams. */
function spawnMcpAsync(args: string[], env: Record<string, string>): SpawnedMcp {
  const child = spawn("bun", [entry, ...args], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer | string) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    stderr += String(chunk);
  });
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  return {
    exited,
    stdout: () => stdout,
    stderr: () => stderr,
    kill: (signal) => child.kill(signal),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("logs-mcp over Streamable HTTP never binds without a fleet credential", () => {
  test("--http --port 0: exits non-zero before binding, remedy first, no listener line, creates nothing", () => {
    const r = tempRoots("neg-http-port0");
    const result = spawnMcp(["--http", "--port", "0"], hermeticEnv(r));

    // A real exit, not the spawn timeout reaping a process that sat listening.
    expect(result.status).not.toBeNull();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    const firstLine = result.stderr.split("\n")[0] ?? "";
    expect(firstLine).toMatch(/hasna\.credentials\.logs\.api-key/);
    expect(firstLine).toMatch(/config\/credentials/);
    expect(firstLine).toMatch(/HASNA_LOGS_API_KEY/);
    expect(firstLine).toMatch(/HASNA_LOGS_LOCAL/);
    expect(result.stderr).not.toMatch(/listening|http:\/\/127\.0\.0\.1/i);
    expect(result.stderr).not.toMatch(/\n\s+at /);
    expect(allDbFiles(r)).toEqual([]);
    expect(existsSync(r.dataDir)).toBe(false);
    expect(existsSync(join(r.hasnaHome, "logs"))).toBe(false);
    expect(existsSync(join(r.home, ".hasna"))).toBe(false);
  });

  test("a reserved port is refused on every probe until exit; an initialize POST never gets an HTTP answer", async () => {
    const r = tempRoots("neg-http-socket");
    const port = await reservePort();
    const child = spawnMcpAsync(["--http", "--port", String(port)], hermeticEnv(r));
    let done = false;
    void child.exited.then(() => {
      done = true;
    });

    const probes: Array<"open" | "refused"> = [];
    let httpAnswered = false;
    const deadline = Date.now() + 20_000;
    while (!done && Date.now() < deadline) {
      probes.push(await probePort(port));
      try {
        // Any HTTP response at all — 200, 406, 500 — means a listener served us.
        const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: INITIALIZE_REQUEST,
        });
        httpAnswered = true;
        await res.text();
      } catch {
        // Connection refused: nothing is listening.
      }
      await sleep(25);
    }
    if (!done) child.kill("SIGKILL");
    const code = await child.exited;

    expect(done).toBe(true);
    expect(code).not.toBeNull();
    expect(code).not.toBe(0);
    expect(probes.length).toBeGreaterThan(0);
    expect(probes.every((outcome) => outcome === "refused")).toBe(true);
    expect(httpAnswered).toBe(false);
    expect(await probePort(port)).toBe("refused");
    expect(child.stdout()).toBe("");
    expect(child.stderr().split("\n")[0] ?? "").toMatch(/hasna\.credentials\.logs\.api-key/);
    expect(child.stderr()).not.toMatch(/listening|http:\/\/127\.0\.0\.1/i);
    expect(allDbFiles(r)).toEqual([]);
  });

  test("a deliberate tier that cannot be honoured refuses before the HTTP bind too", () => {
    const r = tempRoots("neg-http-profile");
    const result = spawnMcp(
      ["--http", "--port", "0"],
      hermeticEnv(r, { HASNA_PROFILE: "no-such-profile" }),
    );

    expect(result.status).not.toBeNull();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.split("\n")[0] ?? "").toMatch(/Profile 'no-such-profile'/);
    expect(result.stderr).not.toMatch(/listening|http:\/\/127\.0\.0\.1/i);
    expect(allDbFiles(r)).toEqual([]);
  });

  test("--version answers before any bind and before any credential tier is consulted", () => {
    const r = tempRoots("http-version");
    const expected = (JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string })
      .version;
    // The profile sentinel would refuse at the gate; metadata must come first.
    const result = spawnMcp(
      ["--http", "--port", "0", "--version"],
      hermeticEnv(r, { HASNA_PROFILE: "no-such-profile" }),
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(expected);
    expect(result.stderr).not.toMatch(/listening|http:\/\/127\.0\.0\.1/i);
    expect(result.stderr).not.toMatch(/hasna\.credentials\.logs\.api-key|no-such-profile/);
    expect(allDbFiles(r)).toEqual([]);
  });

  test("explicit HASNA_LOGS_LOCAL=1 still serves over HTTP: one local-mode notice, then the listener, no db before a tool call", async () => {
    const r = tempRoots("local-http");
    const child = spawnMcpAsync(["--http", "--port", "0"], hermeticEnv(r, { HASNA_LOGS_LOCAL: "1" }));
    let done = false;
    void child.exited.then(() => {
      done = true;
    });

    const deadline = Date.now() + 20_000;
    let listening: RegExpMatchArray | null = null;
    while (!done && !listening && Date.now() < deadline) {
      listening = child.stderr().match(/Streamable HTTP listening on http:\/\/127\.0\.0\.1:(\d+)\/mcp/);
      if (!listening) await sleep(25);
    }
    try {
      expect(done).toBe(false);
      expect(listening).not.toBeNull();
      const port = Number(listening?.[1]);
      const stderr = child.stderr();
      // The notice is printed once, by the preflight, before the bind.
      const notices = stderr.match(/^logs: local mode — /gm) ?? [];
      expect(notices).toHaveLength(1);
      expect(stderr.indexOf("logs: local mode — ")).toBeLessThan(stderr.indexOf("Streamable HTTP listening"));
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok", name: "logs" });
      // Lazy: serving opened nothing on disk.
      expect(allDbFiles(r)).toEqual([]);
    } finally {
      child.kill("SIGTERM");
      await child.exited;
    }
    expect(existsSync(join(r.home, ".hasna"))).toBe(false);
  });
});

describe("a deliberate credential tier that cannot be honoured refuses before serving", () => {
  // Both tiers are DELIBERATE: they name WHICH identity to use, so the resolver
  // never falls through around them (hasna/apps#1720 validation, round 2).
  // Before this round the profile refusal was thrown from the module's top
  // level — first stderr line a Bun source frame — and a vault pointer started
  // the server and refused per tool call instead of at the gate.
  test("HASNA_PROFILE naming a profile with no key: exit non-zero, remedy first, initialize unanswered", () => {
    const r = tempRoots("neg-profile");
    const result = spawnMcp(
      ["--stdio"],
      hermeticEnv(r, { HASNA_PROFILE: "no-such-profile" }),
      `${INITIALIZE_REQUEST}\n`,
    );

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    const firstLine = result.stderr.split("\n")[0] ?? "";
    expect(firstLine).toMatch(/Profile 'no-such-profile'/);
    expect(firstLine).toMatch(/HASNA_PROFILE/);
    expect(firstLine).toMatch(/HASNA_LOGS_API_KEY/);
    expect(result.stderr).not.toMatch(/\n\s+at /);
    expect(result.stderr).not.toMatch(/^\s*\d+ \|/m);
    expect(allDbFiles(r)).toEqual([]);
    expect(existsSync(r.dataDir)).toBe(false);
    expect(existsSync(join(r.hasnaHome, "logs"))).toBe(false);
    expect(existsSync(join(r.home, ".hasna"))).toBe(false);
  });

  test("HASNA_LOGS_API_KEY_REF naming a vault item this process cannot complete: exit non-zero before initialize, TERMINAL first", () => {
    const r = tempRoots("neg-pointer");
    const result = spawnMcp(
      ["--stdio"],
      hermeticEnv(r, { HASNA_LOGS_API_KEY_REF: "no/such/vault/item" }),
      `${INITIALIZE_REQUEST}\n`,
    );

    expect(result.status).not.toBe(0);
    // The gate completed the pointer once and refused: initialize never answered.
    expect(result.stdout).toBe("");
    const firstLine = result.stderr.split("\n")[0] ?? "";
    expect(firstLine).toMatch(/HASNA_LOGS_API_KEY_REF/);
    expect(firstLine).toMatch(/no\/such\/vault\/item/);
    expect(firstLine).toMatch(/TERMINAL/);
    expect(result.stderr).not.toMatch(/\n\s+at /);
    expect(result.stderr).not.toMatch(/^\s*\d+ \|/m);
    expect(allDbFiles(r)).toEqual([]);
    expect(existsSync(r.dataDir)).toBe(false);
    expect(existsSync(join(r.hasnaHome, "logs"))).toBe(false);
    expect(existsSync(join(r.home, ".hasna"))).toBe(false);
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
