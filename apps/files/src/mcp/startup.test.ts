/**
 * Startup contract of the `files-mcp` bin, checked as a spawned process:
 *
 * - `--version` / `--help` answer from argv alone, BEFORE the credential gate
 *   and before any transport connects or any port binds (the published 0.4.0
 *   ignored `--version` and bound Streamable HTTP on 127.0.0.1).
 * - stdio is the DEFAULT transport (the fleet convention and what `--help`
 *   documents); Streamable HTTP is the opt-in.
 * - Fail closed: with no resolvable credential and no local opt-in the server
 *   exits non-zero before serving — never answers `initialize`, never binds
 *   the HTTP port, creates nothing under the app home.
 *
 * Every fail-closed spawn pins `HASNA_STATION` to a sentinel account, so a Mac
 * whose login keychain holds hasna.credentials.files.api-key@<hostname> still
 * resolves nothing: hermetic wherever it runs (hasna/apps#1720).
 */
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import { join } from "path";

const repoRoot = join(import.meta.dir, "..", "..");
const mcpEntry = join(repoRoot, "src", "mcp", "index.ts");
const pkg = createRequire(import.meta.url)("../../package.json") as { version: string };
const tempDirs: string[] = [];

/** Hosted, credential, opt-in and transport inputs a spawned run must not inherit. */
const SCRUBBED_ENV_KEYS = [
  "HASNA_FILES_API_URL",
  "FILES_API_URL",
  "HASNA_FILES_API_KEY",
  "FILES_API_KEY",
  "HASNA_FILES_LOCAL",
  "FILES_LOCAL",
  "HASNA_FILES_LOCAL_MODE",
  "FILES_LOCAL_MODE",
  "HASNA_FILES_STORAGE_MODE",
  "HASNA_PROFILE",
  "HASNA_FILES_API_KEY_OVERRIDE",
  "HASNA_FILES_API_KEY_REF",
  "MCP_HTTP",
  "MCP_STDIO",
  "MCP_HTTP_PORT",
] as const;

const INITIALIZE_REQUEST =
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "startup-test", version: "0.0.0" },
    },
  }) + "\n";

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "files-mcp-startup-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * The suite's own env (the preload's local opt-in included) with the MCP
 * transport env scrubbed and the store pointed at the scratch dir.
 */
function localEnv(dataDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HASNA_FILES_DATA_DIR: dataDir };
  delete env.MCP_HTTP;
  delete env.MCP_STDIO;
  delete env.MCP_HTTP_PORT;
  return env;
}

/**
 * A spawn env with every hosted input and the local opt-in stripped, every
 * ambient credential root (HOME, HASNA_HOME) pointed at the scratch dir, and
 * the Keychain account pinned to a sentinel no station has.
 */
function unconfiguredEnv(dataDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of SCRUBBED_ENV_KEYS) delete env[key];
  return {
    ...env,
    HOME: dataDir,
    HASNA_HOME: dataDir,
    HASNA_STATION: "no-such-station",
    HASNA_FILES_DATA_DIR: dataDir,
  };
}

/**
 * Hold a loopback port open while `fn` runs, so a bind attempt by the child
 * fails loudly (EADDRINUSE) instead of succeeding quietly.
 */
async function withHeldPort<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const holder = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  try {
    return await fn(holder.port);
  } finally {
    holder.stop(true);
  }
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run the MCP entry to completion with `stdin` (then EOF) on its stdin; a
 * process still alive after `timeoutMs` is killed, which is a non-zero exit.
 */
async function runMcp(args: string[], env: NodeJS.ProcessEnv, stdin = "", timeoutMs = 15_000): Promise<SpawnResult> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", mcpEntry, ...args],
    cwd: repoRoot,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdin) proc.stdin.write(stdin);
  proc.stdin.end();
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Drive the MCP entry with an `initialize` request over stdio (stdin kept
 * open, as a client would) and return whatever reached stdout by the time the
 * answer arrived — or by the time the process gave up.
 */
async function initializeOverStdio(args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", mcpEntry, ...args],
    cwd: repoRoot,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(INITIALIZE_REQUEST);
  const reader = proc.stdout.getReader();
  const timeout = setTimeout(() => proc.kill(), 10_000);
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) chunks.push(value);
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.includes('"id":1') || done) {
        proc.kill();
        await proc.exited;
        return { stdout: text, stderr: await new Response(proc.stderr).text() };
      }
    }
  } finally {
    clearTimeout(timeout);
    proc.kill();
  }
}

test("MCP --version prints the package version before the credential gate and never binds a port", async () => {
  const dataDir = makeDataDir();
  await withHeldPort(async (port) => {
    // Unconfigured AND asked for HTTP on a port that is already taken: the
    // version still answers first, with no gate refusal and no bind attempt.
    const result = await runMcp(["--version", "--http", "--port", String(port)], unconfiguredEnv(dataDir));
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
    expect(result.stderr).toBe("");
  });
  expect(existsSync(join(dataDir, "files"))).toBe(false);
  expect(existsSync(join(dataDir, "files.db"))).toBe(false);
});

test("MCP --help exits before the credential gate and never binds a port or opens the files database", async () => {
  const dataDir = makeDataDir();
  await withHeldPort(async (port) => {
    const result = await runMcp(["--help", "--http", "--port", String(port)], unconfiguredEnv(dataDir));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: files-mcp");
    expect(result.stdout).toContain("stdio by default");
    expect(result.stdout).toContain("--stdio");
    expect(result.stdout).toContain("-V, --version");
    expect(result.stdout).toContain("HTTP port (default: 8863, env: MCP_HTTP_PORT)");
    expect(result.stderr).toBe("");
  });
  expect(existsSync(join(dataDir, "files"))).toBe(false);
  expect(existsSync(join(dataDir, "files.db"))).toBe(false);
});

test("MCP initialize responds over --stdio without creating or opening the files database", async () => {
  const dataDir = makeDataDir();
  const { stdout, stderr } = await initializeOverStdio(["--stdio"], localEnv(dataDir));
  expect(stdout).toContain('"id":1');
  expect(stdout).toContain('"protocolVersion"');
  // An opted-in local run says so on stderr, so it is never mistaken for a hosted one.
  expect(stderr).toContain("LOCAL mode");
  await expect(Bun.file(join(dataDir, "files.db")).exists()).resolves.toBe(false);
});

test("MCP serves stdio by DEFAULT: initialize is answered with no transport flag and the HTTP port is never bound", async () => {
  const dataDir = makeDataDir();
  await withHeldPort(async (port) => {
    // Were HTTP still the default, the server would try to bind this held
    // port, die on EADDRINUSE, and never answer on stdout.
    const env = { ...localEnv(dataDir), MCP_HTTP_PORT: String(port) };
    const { stdout, stderr } = await initializeOverStdio([], env);
    expect(stdout).toContain('"id":1');
    expect(stdout).toContain('"protocolVersion"');
    expect(stderr).not.toContain("EADDRINUSE");
    expect(stderr).not.toContain("listening");
  });
  await expect(Bun.file(join(dataDir, "files.db")).exists()).resolves.toBe(false);
});

test("MCP refuses to start without a resolvable credential or a local opt-in (fail closed) and never answers initialize", async () => {
  const dataDir = makeDataDir();
  const result = await runMcp(["--stdio"], unconfiguredEnv(dataDir), INITIALIZE_REQUEST);

  expect(result.exitCode).not.toBe(0);
  // The request on stdin is never answered: nothing reaches stdout.
  expect(result.stdout).toBe("");
  // The FIRST stderr line names where the credential should live — never a value.
  const [firstLine] = result.stderr.split("\n");
  expect(firstLine).toContain("REMOTE_API_CONFIG_MISSING");
  expect(firstLine).toContain("HASNA_FILES_API_URL");
  expect(firstLine).toContain("Keychain");
  expect(firstLine).toContain(join(dataDir, "files", "config", "credentials"));
  expect(firstLine).toContain("HASNA_FILES_API_KEY");
  expect(firstLine).toContain("no local fallback");
  // Nothing is created under the app home, and no on-box store is opened.
  expect(existsSync(join(dataDir, "files"))).toBe(false);
  await expect(Bun.file(join(dataDir, "files.db")).exists()).resolves.toBe(false);
});

test("MCP --http refuses without a resolvable credential BEFORE binding its port (fail closed)", async () => {
  const dataDir = makeDataDir();
  await withHeldPort(async (port) => {
    const result = await runMcp(["--http", "--port", String(port)], unconfiguredEnv(dataDir));
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    const [firstLine] = result.stderr.split("\n");
    expect(firstLine).toContain("REMOTE_API_CONFIG_MISSING");
    expect(firstLine).toContain("Keychain");
    expect(firstLine).toContain(join(dataDir, "files", "config", "credentials"));
    expect(firstLine).toContain("HASNA_FILES_API_KEY");
    // A bind attempt against the held port would have surfaced as EADDRINUSE;
    // a successful one as the harness's "listening" line.
    expect(result.stderr).not.toContain("EADDRINUSE");
    expect(result.stderr).not.toContain("listening");
  });
  expect(existsSync(join(dataDir, "files"))).toBe(false);
  await expect(Bun.file(join(dataDir, "files.db")).exists()).resolves.toBe(false);
});
