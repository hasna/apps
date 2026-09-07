import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RECORDINGS_LOCAL_OPT_IN_ENV_KEYS,
  recordingsAuthorityEnvKeys,
} from "../lib/local-opt-in.js";

// ============================================================================
// End-to-end: the real MCP entry, in a real subprocess, with every recordings
// selector scrubbed out of its environment and a scratch HOME — the shape of a
// coding agent registering `recordings-mcp` on a station without a credential.
// The MCP must fail closed at STARTUP: before any transport connects, before
// any store is resolved, no listener, no answer to `initialize`, no SQLite
// file created anywhere (fail loud, hasna/apps#1720). The deliberate local
// opt-in is the only way through, and it must SAY it is local on stderr.
//
// The spawns run the source entry (process.execPath + src/mcp/index.ts), the
// same convention as trigger-diagnosis.test.ts and mcp-binary-options.test.ts;
// build:mcp bundles this exact entry into dist/mcp/index.js.
// ============================================================================

const repoRoot = join(import.meta.dir, "..", "..");
const MCP_ENTRY = join("src", "mcp", "index.ts");
const LOCAL_OPT_IN_KEYS = RECORDINGS_LOCAL_OPT_IN_ENV_KEYS;
const AUTHORITY_KEYS = recordingsAuthorityEnvKeys();
const AMBIENT_SELECTORS = [
  ...AUTHORITY_KEYS,
  ...LOCAL_OPT_IN_KEYS,
  "HASNA_CONFIG_HOME",
];

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratchHome(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `recordings-mcp-failclosed-${label}-`));
  tempRoots.push(root);
  return root;
}

/**
 * The environment of a scrubbed station: the ambient process env with every
 * recordings selector removed (so a real disk credential or Keychain hint can
 * never leak in), a fresh HOME, a Keychain account that cannot exist, a
 * scratch HASNA_HOME for the disk tier, and the caller's overrides.
 */
function scrubbedStationEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of AMBIENT_SELECTORS) delete env[key];
  return {
    ...env,
    HOME: home,
    HASNA_STATION: "no-such-station",
    HASNA_HOME: join(home, ".hasna"),
    ...extra,
  };
}

/** A newline-framed MCP `initialize` request, as an agent would send it. */
function initializeFrame(): string {
  return (
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "recordings-mcp-failclosed-test", version: "0" },
      },
    }) + "\n"
  );
}

async function runMcp(
  env: Record<string, string>,
  args: string[],
  input: string = "",
  boundMs: number = 15_000,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, MCP_ENTRY, ...args], {
    cwd: repoRoot,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (input) proc.stdin.write(input);
  proc.stdin.end();
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const exited = proc.exited.then((code) => ({ code, timedOut: false }));
  const timer = new Promise<{ code: number | null; timedOut: boolean }>((resolve) =>
    setTimeout(() => resolve({ code: null, timedOut: true }), boundMs)
  );
  const outcome = await Promise.race([exited, timer]);
  if (outcome.timedOut) {
    proc.kill();
    await proc.exited.catch(() => {});
  }
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { exitCode: outcome.code, stdout, stderr };
}

describe("recordings-mcp without a credential fails closed at startup", () => {
  test("--stdio with an initialize request: non-zero, empty stdout, ERROR line naming the tiers, no db", async () => {
    const home = scratchHome("stdio");
    const { exitCode, stdout, stderr } = await runMcp(
      scrubbedStationEnv(home),
      ["--stdio"],
      initializeFrame(),
    );

    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr.split("\n")[0]).toContain("ERROR: REMOTE_API_CONFIG_MISSING");
    expect(stderr).toContain("HASNA_RECORDINGS_API_KEY");
    expect(stderr).toContain("HASNA_RECORDINGS_LOCAL=1");
    expect(stderr).not.toContain("listening");
    // No SQLite file exists anywhere under the scratch home.
    expect(existsSync(join(home, ".hasna", "recordings", "recordings.db"))).toBe(false);
  });

  test("the default HTTP transport refuses to bind: non-zero, no listener, no db", async () => {
    const home = scratchHome("http");
    const { exitCode, stdout, stderr } = await runMcp(scrubbedStationEnv(home), []);

    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr.split("\n")[0]).toContain("ERROR: REMOTE_API_CONFIG_MISSING");
    // Fail-loud happens BEFORE the transport connects: the server must never
    // print its "HTTP listening" line.
    expect(stderr).not.toContain("listening");
    expect(existsSync(join(home, ".hasna", "recordings", "recordings.db"))).toBe(false);
  });

  test("control: an env-tier fixture credential answers initialize and never echoes the key", async () => {
    const home = scratchHome("credential");
    const { exitCode, stdout, stderr } = await runMcp(
      scrubbedStationEnv(home, {
        HASNA_STATION: "no-such-station",
        HASNA_RECORDINGS_API_KEY: "fixture-mcp-env-key",
      }),
      ["--stdio"],
      initializeFrame(),
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('"result"');
    expect(stdout).not.toContain("fixture-mcp-env-key");
    expect(stderr).not.toContain("fixture-mcp-env-key");
    expect(stderr).not.toContain("REMOTE_API_");
  });

  test("control: the deliberate local opt-in starts, says LOCAL mode on stderr, and creates no db", async () => {
    const home = scratchHome("local");
    const { exitCode, stdout, stderr } = await runMcp(
      scrubbedStationEnv(home, { HASNA_RECORDINGS_LOCAL: "1" }),
      ["--stdio"],
      initializeFrame(),
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('"result"');
    expect(stderr.split("\n")[0]).toContain("recordings: LOCAL mode");
    expect(stderr).toMatch(/local/i);
    // The local server may create store DIRECTORIES, never a database.
    expect(existsSync(join(home, ".hasna", "recordings", "recordings.db"))).toBe(false);
  });
});