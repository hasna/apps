// Fail-closed coverage for the spawned CLI (owner ruling 2026-09-04,
// hasna/apps#1720, #1613).
//
// A hosted conversations run with NO resolvable credential must exit non-zero,
// create no SQLite file anywhere under the owning HOME, and emit no
// `*-local-fallback` event. Retired DB selectors also refuse; only explicit
// library construction retains local storage compatibility.
//
// The child environment is built by OMISSION: a sandbox HOME the test owns
// (which also anchors the disk credential tier, `$HOME/.hasna/conversations/
// config/credentials`), a HASNA_STATION no real item uses (so the machine's
// Keychain can never answer), and nothing else copied in — so no ambient fleet
// env can reach the child.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

function hermeticEnv(tempRoot: string): Record<string, string> {
  return {
    HOME: tempRoot,
    PATH: process.env["PATH"] ?? "",
    // No real Keychain item uses this account, so a login-keychain item (on a
    // Mac runner) can never answer for this run.
    HASNA_STATION: `conversations-fail-closed-${crypto.randomUUID()}`,
  };
}

async function runCli(
  args: string[],
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

/**
 * Spawn the MCP entry (`conversations-mcp`) with a piped stdin. `stdinText`
 * is written first (a JSON-RPC line, say); stdin is then closed, which ends a
 * stdio session that did start. A server that refused at startup has exited
 * long before stdin matters.
 */
async function runMcp(
  args: string[],
  env: Record<string, string>,
  stdinText = "",
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", "src/mcp/index.ts", ...args], {
    cwd: ROOT,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdinText) proc.stdin.write(stdinText);
  proc.stdin.end();
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

const INITIALIZE_REQUEST =
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fail-closed-probe", version: "0" } },
  }) + "\n";

/** Recursively list every *.db / *.sqlite / *.sqlite3 file under a root. */
function sqliteFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sqliteFilesUnder(full));
    else if (/\.(?:db|sqlite3?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("fail-closed transport resolution (spawned CLI)", () => {
  test("hosted with no credential exits non-zero, names the required vars, and creates no SQLite", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-fail-closed-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);

    const result = await runCli(["status"], env);

    expect(result.exitCode).not.toBe(0);
    // The refusal names the canonical API variables (the tiers to fix).
    expect(result.stderr).toContain("HASNA_CONVERSATIONS_API_URL");
    expect(result.stderr).toContain("HASNA_CONVERSATIONS_API_KEY");
    // Shared account guidance replaces the retired local opt-in.
    expect(result.stderr).toContain("HASNA_CONVERSATIONS_API_KEY");
    // The seam throws before any SQLite open can run: no database file may
    // exist anywhere under the owning HOME.
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
    expect(existsSync(join(tempRoot, ".hasna", "conversations"))).toBe(false);
  });

  test("under --json the refusal honours the JSON error contract on stdout", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-fail-closed-json-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);

    const result = await runCli(["status", "--json"], env);

    expect(result.exitCode).not.toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.error).toContain("HASNA_CONVERSATIONS_API_URL");
    expect(parsed.code).toBe("CONVERSATIONS_STORE_CONFIG");
  });

  test("no *-local-fallback event is emitted — the legacy silent degradation is gone", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-fail-closed-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);

    const result = await runCli(["status"], env);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toMatch(/-local-fallback/i);
    expect(result.stderr).not.toMatch(/falling?\s*back/i);
  });

  test("the retired local selector refuses status without creating storage", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-local-opt-in-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);
    env["HASNA_CONVERSATIONS_DB_PATH"] = join(tempRoot, "store.db");

    const result = await runCli(["status"], env);

    expect(result.exitCode).not.toBe(0);
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
    expect(result.stderr).toContain("no longer supported");
    expect(result.stdout).not.toContain("serverInfo");
    expect(result.stdout).not.toContain("Connection: SQLite");
    expect(result.stdout).not.toContain("scanned");
  });

  test("the unprefixed retired selector also refuses status", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-local-opt-in-alias-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);
    env["CONVERSATIONS_DB_PATH"] = join(tempRoot, "store.db");

    const result = await runCli(["status"], env);

    expect(result.exitCode).not.toBe(0);
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
    expect(result.stderr).toContain("no longer supported");
    expect(result.stdout).not.toContain("serverInfo");
    expect(result.stdout).not.toContain("Connection: SQLite");
    expect(result.stdout).not.toContain("scanned");
  });
});

// `events-drain` routes through the Store like every other command: the
// on-box SQLite outbox spools into the on-box events spool inbox, and the
// hosted API runs the server's own outbox worker. It used to call `getDb()`
// directly, bypassing the Store seam: hosted with no credential it exited 0
// with "scanned 0", printed no local notice, and created messages.db (+
// WAL/SHM) under the app home (hasna/apps#1720 validation; acceptance (c)
// and (f)). The fail-closed property now holds by delegation: with neither a
// credential nor a store path, `getStore()` refuses before anything is opened.
describe("fail-closed: events-drain resolves through the Store (spawned CLI)", () => {
  test("hosted with no credential: exits non-zero, no 'scanned' line, no SQLite anywhere under HOME", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-fail-closed-drain-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);

    const result = await runCli(["events-drain"], env);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("scanned");
    // The refusal is the store config refusal, naming the required API credential.
    expect(result.stderr).toContain("HASNA_CONVERSATIONS_API_KEY");
    expect(result.stderr).not.toMatch(/-local-fallback/i);
    expect(result.stderr).not.toMatch(/falling?\s*back/i);
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
    expect(existsSync(join(tempRoot, ".hasna", "conversations"))).toBe(false);
  });

  test("a resolved hosted credential routes events-drain to the hosted API — nothing opened on-box", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-fail-closed-drain-key-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);
    env["HASNA_CONVERSATIONS_API_KEY"] = ["fixture", "not", "a", "credential"].join("-");
    // Loopback URL keeps the test-context guard satisfied; the refused port
    // fails the hosted drain fast instead of reaching the fleet.
    env["HASNA_CONVERSATIONS_API_URL"] = "http://127.0.0.1:9";

    const result = await runCli(["events-drain"], env);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("scanned");
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
    expect(existsSync(join(tempRoot, ".hasna", "conversations"))).toBe(false);
  });

  test("the retired local selector refuses drain without creating storage", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-drain-local-opt-in-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);
    const localDb = join(tempRoot, "store.db");
    env["HASNA_CONVERSATIONS_DB_PATH"] = localDb;

    const result = await runCli(["events-drain"], env);

    expect(result.exitCode).not.toBe(0);
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
    expect(result.stderr).toContain("no longer supported");
    expect(result.stdout).not.toContain("serverInfo");
    expect(result.stdout).not.toContain("Connection: SQLite");
    expect(result.stdout).not.toContain("scanned");
  });

  // Round-2 review of hasna/apps#1864: the command accepted no `--json`, so
  // Commander rejected the flag as unknown before the action ran and the
  // refusal never reached the JSON error contract.
  test("under --json the refusal honours the JSON error contract on stdout, and nothing is opened", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-fail-closed-drain-json-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);

    const result = await runCli(["events-drain", "--json"], env);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toContain("unknown option");
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.code).toBe("CONVERSATIONS_STORE_CONFIG");
    // The refusal is the generic store config refusal (the old per-surface
    // gate message that named `events-drain` is gone), and it names the API credential.
    expect(parsed.error).toContain("HASNA_CONVERSATIONS_API_KEY");
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
  });

  test("under --json a retired selector returns a structured refusal", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-drain-local-json-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);
    env["HASNA_CONVERSATIONS_DB_PATH"] = join(tempRoot, "store.db");

    const result = await runCli(["events-drain", "--json"], env);

    expect(result.exitCode).not.toBe(0);
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
    const receipt = JSON.parse(result.stdout.trim());
    expect(receipt.code).toBe("CONVERSATIONS_STORE_CONFIG");
    expect(receipt.error).toContain("no longer supported");
  });
});

// The MCP server must fail closed BEFORE SERVING, not per tool call
// (acceptance (c) of hasna/apps#1720; round-2 review of #1864; the gate
// @hasna/mementos received in #1868). Until now `startMcpServer()` connected
// the stdio transport straight away and every tool resolved the store on its
// own: hosted with no credential, `initialize` was answered and each tool
// returned an `isError` result — a healthy-looking server on a station that
// had nothing to serve.
describe("fail-closed: the MCP server refuses before serving (spawned conversations-mcp)", () => {
  test("hosted with no credential: exits non-zero before serving, names the credential tiers, creates no SQLite", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-mcp-fail-closed-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);

    const result = await runMcp(["--stdio"], env);

    expect(result.exitCode).not.toBe(0);
    // Nothing was served: a stdio MCP server writes JSON-RPC to stdout only.
    expect(result.stdout).toBe("");
    // The FIRST stderr line is the refusal, and it names where the credential
    // should live; no local selector is recommended.
    const firstLine = result.stderr.split("\n")[0] ?? "";
    expect(firstLine).toContain("HASNA_CONVERSATIONS_API_KEY");
    expect(result.stderr).toContain("HASNA_CONVERSATIONS_API_KEY");
    expect(result.stderr).not.toMatch(/-local-fallback/i);
    expect(result.stderr).not.toMatch(/falling?\s*back/i);
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
    expect(existsSync(join(tempRoot, ".hasna", "conversations"))).toBe(false);
  });

  test("an initialize request over stdio is NOT answered when no credential resolves", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-mcp-fail-closed-init-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);

    const result = await runMcp(["--stdio"], env, INITIALIZE_REQUEST);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("serverInfo");
    expect(result.stdout).not.toContain('"result"');
    expect(result.stderr).toContain("HASNA_CONVERSATIONS_API_KEY");
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
  });

  test("a resolved hosted credential is not enough to open local: still hosted, nothing under HOME", async () => {
    // Positive control for the gate itself: with a credential in the env
    // tier the server starts (initialize is answered) and no on-box store is
    // created as a side effect of startup. No request leaves the process —
    // initialize is answered locally by the MCP SDK.
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-mcp-hosted-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);
    env["HASNA_CONVERSATIONS_API_KEY"] = ["fixture", "not", "a", "credential"].join("-");

    const result = await runMcp(["--stdio"], env, INITIALIZE_REQUEST);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("serverInfo");
    expect(result.stderr).not.toContain("LOCAL mode");
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
    expect(existsSync(join(tempRoot, ".hasna", "conversations"))).toBe(false);
  }, 30_000);

  test("the retired local selector refuses MCP before initialize", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-mcp-local-opt-in-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);
    env["HASNA_CONVERSATIONS_DB_PATH"] = join(tempRoot, "store.db");

    const result = await runMcp(["--stdio"], env, INITIALIZE_REQUEST);

    expect(result.exitCode).not.toBe(0);
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
    expect(result.stderr).toContain("no longer supported");
    expect(result.stdout).not.toContain("serverInfo");
    expect(result.stdout).not.toContain("Connection: SQLite");
    expect(result.stdout).not.toContain("scanned");
  }, 30_000);

  test("--http: hosted with no credential exits non-zero before binding a port", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-mcp-http-fail-closed-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);

    // `--port 0` would let the OS pick a free port if the server ever got
    // that far; the gate must fire first.
    const result = await runMcp(["--http", "--port", "0"], env);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toContain("listening");
    expect(result.stderr).toContain("HASNA_CONVERSATIONS_API_KEY");
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
  });

  test("the CLI's `mcp` subcommand raises the same refusal through the CLI error surface", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-cli-mcp-fail-closed-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);

    const result = await runCli(["mcp"], env);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("HASNA_CONVERSATIONS_API_KEY");
    expect(result.stderr).toContain("HASNA_CONVERSATIONS_API_KEY");
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
  });
});
