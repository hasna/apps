/**
 * Fail-closed MCP startup tests (owner ruling 2026-09-04, hasna/apps#1720 —
 * checklist items 2, 3 and 6).
 *
 * The MCP server is a domain client: every tool goes through `getStore()` and
 * therefore through the @hasna/contracts chain. Serving with no resolvable
 * credential would produce a live server that answers `initialize` and then
 * fails every tool call — the exact defect these tests reproduce on the old
 * entry (serverInfo answered at rc 0, `--http` crashed with a Bun source
 * frame at rc 0; see `calendarMcpStartupRefusal`). The gate must therefore
 * refuse BEFORE the stdio transport connects or the `--http` port is bound:
 * exit 1, first stderr line `calendar-mcp: refusing to start — …` naming the
 * credential tiers, `initialize` answered by nobody, no socket, and nothing
 * opened or created under the owning HOME.
 *
 * The spawned entry is hermetic: HOME is a scratch dir the test owns, the
 * Keychain account is pinned to a name no item can exist under, and the hasna
 * home points at a path that exists nowhere — the same omissions the CLI
 * fail-closed suite uses, so the machine's real credentials can never leak
 * into a run whose whole point is that nothing resolves.
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_KEYCHAIN_ACCOUNT, TEST_HASNA_HOME } from "../test/env-isolation.preload.js";

setDefaultTimeout(120_000);

const ROOT = join(import.meta.dir, "..", "..");
const MCP_ENTRY = "src/mcp/index.ts";
const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
  }
});

function hermeticEnv(tempRoot: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    HOME: tempRoot,
    PATH: process.env["PATH"] ?? "",
    // Keychain tier: ambient for the spawned process; pinning the account to
    // a name no item uses — and pointing the disk root at a path that exists
    // nowhere — keeps the machine's real credential out of the run.
    HASNA_STATION: TEST_KEYCHAIN_ACCOUNT,
    HASNA_HOME: TEST_HASNA_HOME,
    ...extra,
  };
}

/** Recursively list every *.db / *.sqlite / *.sqlite3 file under a root. */
function sqliteFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sqliteFilesUnder(full));
    else if (/\.(?:db|sqlite3?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

interface McpRun {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}

/**
 * Spawn the real MCP entry and exchange JSON-RPC over stdio.
 *
 * `input` (when given) is written to stdin and piped (closed) immediately —
 * the transport never gets to read it when the startup gate refuses. A
 * started server stays alive awaiting further input, so positive controls
 * read a response and then kill the process.
 */
async function runMcp(
  args: string[],
  env: Record<string, string>,
  input?: string,
  settleMs = 15_000,
): Promise<McpRun> {
  const proc = Bun.spawn(["bun", "run", MCP_ENTRY, ...args], {
    cwd: ROOT,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (input !== undefined) {
    // The stdio transport reads NEWLINE-terminated JSON-RPC lines; without the
    // newline a started server buffers forever and never answers.
    proc.stdin.write(`${input}\n`);
  }
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const timedOut = await Promise.race([
    proc.exited.then(() => false),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        proc.kill();
        resolve(true);
      }, settleMs);
    }),
  ]);
  proc.stdin.end();
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { stdout, stderr, code: proc.exitCode ?? -1, timedOut };
}

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "fail-closed-startup-probe", version: "0" },
  },
});

function assertStartupRefusal(result: McpRun, markers: string[]): void {
  expect(result.timedOut).toBe(false);
  expect(result.code).not.toBe(0);
  expect(result.stdout).toBe("");
  // The fail-closed diagnostic is the FIRST stderr line, frame-free.
  expect(result.stderr.split("\n")[0]).toMatch(/^calendar-mcp: refusing to start/);
  for (const marker of markers) expect(result.stderr).toContain(marker);
  expect(result.stderr).not.toMatch(/\.ts:\d+/);
  expect(result.stderr).not.toMatch(/serverInfo|initialize/i);
}

describe("calendar-mcp fail-closed startup (hosted, no credential)", () => {
  test("stdio: no credential anywhere refuses before initialize is answered, creating nothing", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "calendar-mcp-fail-closed-"));
    tempRoots.push(tempRoot);

    const result = await runMcp([], hermeticEnv(tempRoot), INITIALIZE);

    assertStartupRefusal(result, [
      "hasna.credentials.calendar.api-key",
      "config/credentials",
      "HASNA_CALENDAR_API_KEY",
    ]);
    expect(result.stderr).toContain("HASNA_CALENDAR_API_URL");
    // No SQLite, no hasna/calendar roots, no migration root.
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
    expect(existsSync(join(tempRoot, ".hasna"))).toBe(false);
    expect(existsSync(join(tempRoot, ".calendar"))).toBe(false);
  });

  test("stdio: a URL without a key refuses naming the missing key, never rendering the URL value", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "calendar-mcp-fail-closed-urlonly-"));
    tempRoots.push(tempRoot);

    const result = await runMcp(
      [],
      { ...hermeticEnv(tempRoot), HASNA_CALENDAR_API_URL: "https://calendar.example.test" },
      INITIALIZE,
    );

    assertStartupRefusal(result, ["HASNA_CALENDAR_API_KEY is required"]);
    expect(result.stderr).not.toContain("calendar.example.test");
  });

  test("stdio: a retired placement selector is refused loudly", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "calendar-mcp-fail-closed-retired-"));
    tempRoots.push(tempRoot);

    const result = await runMcp(
      [],
      { ...hermeticEnv(tempRoot), HASNA_CALENDAR_MODE: "local" },
      INITIALIZE,
    );

    assertStartupRefusal(result, ["retired Calendar placement selectors", "HASNA_CALENDAR_MODE"]);
  });

  test("stdio: an unsafe disk credentials file refuses, never resolves around", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "calendar-mcp-fail-closed-disk-"));
    tempRoots.push(tempRoot);
    // A credentials file at 0644 under the hasna home the resolver consults:
    // the disk tier exists but is unsafe, so the strict seam refuses rather
    // than falling through to the env tier.
    const file = join(tempRoot, "calendar", "config", "credentials");
    mkdirSync(join(tempRoot, "calendar", "config"), { recursive: true });
    writeFileSync(file, "HASNA_CALENDAR_API_KEY=disk-key\n", { mode: 0o644 });

    const result = await runMcp(
      [],
      {
        HOME: tempRoot,
        PATH: process.env["PATH"] ?? "",
        HASNA_STATION: TEST_KEYCHAIN_ACCOUNT,
        HASNA_HOME: tempRoot,
      },
      INITIALIZE,
    );

    assertStartupRefusal(result, ["credential", "permission"]);
  });

  test("--http: the same gate refuses before any port is bound", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "calendar-mcp-fail-closed-http-"));
    tempRoots.push(tempRoot);

    const result = await runMcp(["--http", "--port", "18992"], hermeticEnv(tempRoot));

    assertStartupRefusal(result, [
      "hasna.credentials.calendar.api-key",
      "config/credentials",
      "HASNA_CALENDAR_API_KEY",
    ]);
  });

  test("control: an env credential starts the stdio server and answers initialize", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "calendar-mcp-fail-closed-control-"));
    tempRoots.push(tempRoot);

    const result = await runMcp(
      [],
      {
        ...hermeticEnv(tempRoot),
        HASNA_CALENDAR_API_URL: "https://calendar.example.test",
        HASNA_CALENDAR_API_KEY: "fixture-key",
      },
      INITIALIZE,
      6_000,
    );

    expect(result.timedOut).toBe(true); // a started server stays alive on stdio
    const answer = JSON.parse(result.stdout.split("\n")[0]!) as {
      result?: { serverInfo?: { name?: string } };
    };
    expect(answer.result?.serverInfo?.name).toBe("calendar");
    expect(result.stderr).toBe("");
    // The control run must create nothing under the owning HOME either.
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
  });

  test("control: --help and --version answer rc=0 WITHOUT any credential (gate sits after early args)", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "calendar-mcp-fail-closed-early-"));
    tempRoots.push(tempRoot);

    const version = await runMcp(["--version"], hermeticEnv(tempRoot));
    expect(version.timedOut).toBe(false);
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(version.stderr).toBe("");

    const help = await runMcp(["--help"], hermeticEnv(tempRoot));
    expect(help.timedOut).toBe(false);
    expect(help.code).toBe(0);
    expect(help.stdout.toLowerCase()).toContain("usage");
    expect(help.stderr).toBe("");
  });
});