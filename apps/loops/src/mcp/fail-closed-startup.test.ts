import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * End-to-end: the real `loops-mcp` entry in a real subprocess with NO
 * connection configured (hermetic against the station: a fully constructed
 * env — no inherited variables — an absent Keychain account via the
 * HASNA_STATION sentinel, an empty HASNA_HOME, no env key). The server must
 * fail closed at STARTUP in EVERY mode — non-zero exit before the stdio
 * transport is connected or the Streamable HTTP port is bound, an
 * `initialize` request never answered, nothing created under the app home
 * (no *.db) — not merely refuse individual tool calls (hasna/apps#1720
 * validation, round 3; the MCP negative control that failed on 0.7.0).
 */

const LOOPS_ROOT = join(import.meta.dir, "../..");
const HTTP_MARKER = "HTTP listening on";
const REFUSAL_MARKER = "loops-mcp: refusing to start";
const KEYCHAIN_ITEM = "hasna.credentials.loops.api-key";
const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fail-closed-test", version: "0" } },
});

const tempHomes: string[] = [];
afterEach(() => {
  for (const tempHome of tempHomes.splice(0)) rmSync(tempHome, { recursive: true, force: true });
});

interface RunOptions {
  args?: string[];
  overrides?: Record<string, string>;
  stdinText?: string;
  prepare?: (tempHome: string) => void;
  /** Kill a server that DID start after this long; the refusal under test exits on its own. */
  killAfterMs?: number;
  /** Resolve as soon as this stderr marker appears (a server that started), instead of waiting for exit. */
  stopOnStderr?: string;
}

interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  tempHome: string;
}

/** Recursively list every *.db / *.sqlite / *.sqlite3 file under a root. */
function sqliteFilesUnder(dir: string, depth = 0): string[] {
  if (depth > 8) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sqliteFilesUnder(full, depth + 1));
    else if (/\.(?:db|sqlite3?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

async function runMcp(options: RunOptions = {}): Promise<RunResult> {
  const root = mkdtempSync(join(tmpdir(), "loops-mcp-failclosed-"));
  tempHomes.push(root);
  // HOME and HASNA_HOME are SEPARATE fresh dirs: the runtime itself drops
  // cache/state under HOME (e.g. macOS `~/Library`), so "the app home is
  // untouched" is asserted on the HASNA_HOME dir the disk tier and the data
  // dir resolve through, exactly as the station control does.
  const home = join(root, "home");
  const tempHome = join(root, "hasna");
  mkdirSync(home, { recursive: true });
  mkdirSync(tempHome, { recursive: true });
  options.prepare?.(tempHome);
  // The control form: `env -i HOME=… USER=… PATH=… HASNA_HOME=<fresh>` plus
  // the absent-station sentinel. Nothing else is inherited, so a developer's
  // own HASNA_LOOPS_* selection, MCP_HTTP/MCP_STDIO, or credential can never
  // leak into the assertions; the disk tier is anchored under the temp home.
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    USER: process.env.USER ?? "loops-test",
    HASNA_HOME: tempHome,
    HASNA_STATION: "no-such-station",
    NO_COLOR: "1",
    ...(options.overrides ?? {}),
  };
  const proc = Bun.spawn([process.execPath, "--no-env-file", "run", "src/mcp/index.ts", ...(options.args ?? [])], {
    cwd: LOOPS_ROOT,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    if (options.stdinText) proc.stdin.write(`${options.stdinText}\n`);
    // A closed stdin ends a stdio MCP session that DID start; a server that
    // refused at startup is already gone and the write is simply lost.
    proc.stdin.end();
  } catch {
    /* the child exited before stdin was written — the refusal under test */
  }
  let stderr = "";
  let markerSeen!: () => void;
  const marker = new Promise<void>((resolve) => { markerSeen = resolve; });
  const stderrPromise = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr) {
      stderr += decoder.decode(chunk, { stream: true });
      if (options.stopOnStderr && stderr.includes(options.stopOnStderr)) markerSeen();
    }
    stderr += decoder.decode();
  })();
  const stdoutPromise = new Response(proc.stdout).text();
  let timedOut = false;
  const deadline = new Promise<void>((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve();
    }, options.killAfterMs ?? 15_000);
  });
  await Promise.race([proc.exited.then(() => undefined), options.stopOnStderr ? marker : new Promise<never>(() => {}), deadline]);
  if (proc.exitCode === null) {
    proc.kill("SIGTERM");
    const forceStop = setTimeout(() => proc.kill("SIGKILL"), 1_000);
    try {
      await proc.exited;
    } finally {
      clearTimeout(forceStop);
    }
  }
  const [stdout] = await Promise.all([stdoutPromise, stderrPromise]);
  return { stdout, stderr, code: proc.exitCode, timedOut, tempHome };
}

function expectRefusedBeforeServing(result: RunResult): string {
  expect(result.timedOut).toBe(false);
  expect(result.code).not.toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain(HTTP_MARKER);
  expect(result.stderr).not.toContain("local-fallback");
  expect(result.stderr).not.toMatch(/^\s+at /m); // a refusal is a message, never a stack trace
  expect(readdirSync(result.tempHome)).toEqual([]);
  expect(sqliteFilesUnder(result.tempHome)).toEqual([]);
  const [firstLine] = result.stderr.split("\n");
  expect(firstLine).toContain(REFUSAL_MARKER);
  return firstLine ?? "";
}

describe("loops-mcp without a connection fails closed at startup, in every mode", () => {
  test("FAILING INPUT: the default (Streamable HTTP) mode exits non-zero before binding, names the tiers on the first stderr line, creates nothing", async () => {
    // Port 0 keeps a REGRESSION (a bind) from colliding with a running
    // loops-mcp on :8890; the fixed server never reaches the bind at all.
    const result = await runMcp({ args: ["--port", "0"] });
    const firstLine = expectRefusedBeforeServing(result);
    expect(firstLine).toContain("no loops client connection is configured");
    expect(firstLine).toContain(KEYCHAIN_ITEM);
    expect(firstLine).toContain(join(result.tempHome, "loops", "config", "credentials"));
    expect(firstLine).toContain("HASNA_LOOPS_API_KEY");
    expect(firstLine).toContain("HASNA_LOOPS_LOCAL=1");
  }, 20_000);

  test("--http --port 0 exits non-zero without binding a port", async () => {
    const result = await runMcp({ args: ["--http", "--port", "0"] });
    const firstLine = expectRefusedBeforeServing(result);
    expect(firstLine).toContain("HASNA_LOOPS_API_KEY");
  }, 20_000);

  test("FAILING INPUT: --stdio with an initialize request on stdin exits non-zero and NEVER answers it", async () => {
    // Previously: initialize answered (serverInfo open-loops), exit 0 on EOF.
    const result = await runMcp({ args: ["--stdio"], stdinText: INITIALIZE });
    const firstLine = expectRefusedBeforeServing(result);
    expect(result.stdout).not.toContain('"result"');
    expect(firstLine).toContain(KEYCHAIN_ITEM);
    expect(firstLine).toContain("HASNA_LOOPS_API_KEY");
  }, 20_000);

  test("--stdio with stdin closed exits non-zero before serving", async () => {
    const result = await runMcp({ args: ["--stdio"] });
    expectRefusedBeforeServing(result);
  }, 20_000);

  test("MCP_STDIO=1 (the env spelling of --stdio) is gated the same way", async () => {
    const result = await runMcp({ overrides: { MCP_STDIO: "1" }, stdinText: INITIALIZE });
    expectRefusedBeforeServing(result);
    expect(result.stdout).not.toContain('"result"');
  }, 20_000);
});

describe("loops-mcp refuses a deliberate tier it cannot honour, at startup", () => {
  test("FAILING INPUT: a vault pointer that cannot be dereferenced exits non-zero before serving; initialize is NOT answered; first stderr line names HASNA_LOOPS_API_KEY_REF", async () => {
    const result = await runMcp({ args: ["--stdio"], overrides: { HASNA_LOOPS_API_KEY_REF: "no/such/vault/item" }, stdinText: INITIALIZE });
    const firstLine = expectRefusedBeforeServing(result);
    expect(firstLine).toContain("HASNA_LOOPS_API_KEY_REF");
    expect(result.stdout).not.toContain('"result"');
  }, 20_000);

  test("HASNA_PROFILE naming a missing profile file exits non-zero on one line naming that file, in HTTP mode too", async () => {
    const result = await runMcp({ args: ["--port", "0"], overrides: { HASNA_PROFILE: "no-such-profile" } });
    const firstLine = expectRefusedBeforeServing(result);
    expect(firstLine).toContain("HASNA_PROFILE");
    expect(firstLine).toContain(join(result.tempHome, "loops", "config", "credentials-no-such-profile"));
  }, 20_000);

  test("an unsafe (0644) credentials file under HASNA_HOME is a one-line refusal naming the file, never a value", async () => {
    let path = "";
    const result = await runMcp({
      args: ["--stdio"],
      stdinText: INITIALIZE,
      prepare: (tempHome) => {
        const dir = join(tempHome, "loops", "config");
        mkdirSync(dir, { recursive: true });
        path = join(dir, "credentials");
        writeFileSync(path, "HASNA_LOOPS_API_KEY=disk-key-not-a-real-secret\n");
        chmodSync(path, 0o644);
      },
    });
    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    const [firstLine] = result.stderr.split("\n");
    expect(firstLine).toContain(REFUSAL_MARKER);
    expect(firstLine).toContain(path);
    expect(result.stderr).not.toContain("disk-key-not-a-real-secret");
    expect(result.stderr).not.toContain(HTTP_MARKER);
    // Only the file the test wrote exists; nothing else was created.
    expect(readdirSync(join(result.tempHome, "loops", "config"))).toEqual(["credentials"]);
  }, 20_000);
});

describe("loops-mcp controls: a configured connection still serves", () => {
  test("an env credential answers initialize over stdio, creating no store and leaking no value", async () => {
    const result = await runMcp({
      args: ["--stdio"],
      overrides: { HASNA_LOOPS_API_URL: "https://loops.example.invalid", HASNA_LOOPS_API_KEY: "test-key-not-a-real-secret" },
      stdinText: INITIALIZE,
    });
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"result"');
    expect(result.stdout).toContain('"name":"open-loops"');
    expect(result.stderr).not.toContain(REFUSAL_MARKER);
    expect(result.stdout + result.stderr).not.toContain("test-key-not-a-real-secret");
    expect(readdirSync(result.tempHome)).toEqual([]);
  }, 20_000);

  test("the 0600 credentials file under HASNA_HOME starts the stdio server through the same chain", async () => {
    const result = await runMcp({
      args: ["--stdio"],
      stdinText: INITIALIZE,
      prepare: (tempHome) => {
        const dir = join(tempHome, "loops", "config");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "credentials"), "HASNA_LOOPS_API_KEY=disk-key-not-a-real-secret\n");
        chmodSync(join(dir, "credentials"), 0o600);
      },
    });
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"result"');
    expect(result.stdout + result.stderr).not.toContain("disk-key-not-a-real-secret");
    expect(readdirSync(result.tempHome)).toEqual(["loops"]);
    expect(readdirSync(join(result.tempHome, "loops"))).toEqual(["config"]);
  }, 20_000);

  test("an env credential still binds the default Streamable HTTP transport (the gate is not a stdio-only gate)", async () => {
    const result = await runMcp({
      args: ["--port", "0"],
      overrides: { HASNA_LOOPS_API_URL: "https://loops.example.invalid", HASNA_LOOPS_API_KEY: "test-key-not-a-real-secret" },
      stopOnStderr: HTTP_MARKER,
    });
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toContain(HTTP_MARKER);
    expect(result.stderr).not.toContain(REFUSAL_MARKER);
    expect(result.stderr).not.toContain("test-key-not-a-real-secret");
    expect(readdirSync(result.tempHome)).toEqual([]);
  }, 20_000);

  test("the explicit HASNA_LOOPS_LOCAL=1 opt-in serves over stdio and announces local mode once on stderr", async () => {
    const result = await runMcp({
      args: ["--stdio"],
      overrides: { HASNA_LOOPS_LOCAL: "1" },
      stdinText: INITIALIZE,
    });
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"result"');
    expect(result.stderr).not.toContain(REFUSAL_MARKER);
    expect(result.stderr.match(/loops: LOCAL mode/g)?.length ?? 0).toBe(1);
    expect(result.stderr).toContain("HASNA_LOOPS_LOCAL");
    expect(result.stderr).toContain("hasna.credentials.loops.api-key");
  }, 20_000);
});
