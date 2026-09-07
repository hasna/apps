import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStartupFixture, startupFixtureEnv } from "./helpers/startup-fixture";
import { signingFixtureCommand } from "./helpers/signing-fixture";

// ============================================================================
// End-to-end: the real MCP entry, in a real subprocess, with every recordings
// selector absent from a fresh environment and a scratch HOME — the shape of a
// coding agent registering `recordings-mcp` on a station without a credential.
// The MCP must fail closed at STARTUP: before any transport connects, before
// any store is resolved, no listener, no answer to `initialize`, no SQLite
// file created anywhere (fail loud, hasna/apps#1720). The deliberate local
// opt-in is the only way through, and it must SAY it is local on stderr.
//
// The spawns run the source entry (process.execPath + src/mcp/index.ts), the
// native-boundary preload cannot skip main(), mock the resolver or answer the
// initialize request. build:mcp bundles this same entry into dist/mcp/index.js.
// ============================================================================

const MCP_ENTRY = join(import.meta.dir, "../mcp/index.ts");
const PRELOAD = join(import.meta.dir, "helpers/mcp-startup-preload.ts");

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratchHome(label: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `recordings-mcp-failclosed-${label}-`)));
  chmodSync(root, 0o700);
  tempRoots.push(root);
  return root;
}

// HOME and a sentinel account alone cannot isolate macOS Keychain. The child
// runs under an OS sandbox with a test-only native command boundary; the
// production Darwin resolver still sees the real platform and chooses tiers.
const scrubbedStationEnv = startupFixtureEnv;

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

async function runMcp(env: Record<string, string>, args: string[], input = "") {
  const home = env.HOME!;
  const result = await runStartupFixture(home, [process.execPath, "--preload", PRELOAD, MCP_ENTRY, ...args], env, input);
  const receipt = JSON.parse(readFileSync(join(home, "mcp-boundary.json"), "utf8"));
  expect(receipt.platform).toBe(process.platform);
  expect(receipt.denied).toBe(0);
  expect(receipt.listeners).toBe(0);
  // Check every fixture descendant, not only one presumed default path.
  const files = readdirSync(home, { recursive: true }).map(String);
  expect(files.filter(path => /\.(?:db|sqlite|sqlite3)(?:-|$)/.test(path))).toEqual([]);
  return { ...result, receipt };
}

function keychainLookups(home: string) {
  const path = join(home, "keychain-fixture.jsonl");
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
}

describe("recordings-mcp without a credential fails closed at startup", () => {
  test("--stdio with an initialize request: non-zero, empty stdout, ERROR line naming the tiers, no db", async () => {
    const home = scratchHome("stdio");
    const { exitCode, stdout, stderr } = await runMcp(
      scrubbedStationEnv(home),
      ["--stdio"],
      initializeFrame(),
    );

    expect(exitCode, stderr).toBe(1);
    expect(stdout).toBe("");
    expect(stderr.split("\n")[0]).toContain("ERROR: REMOTE_API_CONFIG_MISSING");
    expect(stderr).toContain("HASNA_RECORDINGS_API_KEY");
    expect(stderr).toContain("HASNA_RECORDINGS_LOCAL=1");
    if (process.platform === "darwin") expect(keychainLookups(home).some(row => row.service.endsWith("api-key"))).toBe(true);
    expect(stderr).not.toContain("listening");
    // No SQLite file exists anywhere under the scratch home.
    expect(existsSync(join(home, ".hasna", "recordings", "recordings.db"))).toBe(false);
  });

  test("the default HTTP transport refuses to bind: non-zero, no listener, no db", async () => {
    const home = scratchHome("http");
    const { exitCode, stdout, stderr } = await runMcp(scrubbedStationEnv(home), []);

    expect(exitCode, stderr).toBe(1);
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
        HASNA_RECORDINGS_API_KEY: "fixture-mcp-env-key",
      }),
      ["--stdio"],
      initializeFrame(),
    );

    expect(exitCode).toBe(0);
    const response = JSON.parse(stdout.trim());
    expect(response.id).toBe(1);
    expect(response.result.protocolVersion).toBe("2024-11-05");
    expect(response.result.serverInfo.name).toBe("recordings");
    expect(stdout).not.toContain("fixture-mcp-env-key");
    expect(stderr).not.toContain("fixture-mcp-env-key");
    expect(stderr).not.toContain("REMOTE_API_");
    if (process.platform === "darwin") expect(keychainLookups(home).some(row => row.service.endsWith("api-key"))).toBe(true);
  });

  test("control: the deliberate local opt-in starts, says LOCAL mode on stderr, and creates no db", async () => {
    const home = scratchHome("local");
    const { exitCode, stdout, stderr, receipt } = await runMcp(
      scrubbedStationEnv(home, { HASNA_RECORDINGS_LOCAL: "1", RECORDINGS_TEST_KEYCHAIN_MODE: "locked" }),
      ["--stdio"],
      initializeFrame(),
    );

    expect(exitCode).toBe(0);
    const response = JSON.parse(stdout.trim());
    expect(response.id).toBe(1);
    expect(response.result.protocolVersion).toBe("2024-11-05");
    expect(response.result.serverInfo.name).toBe("recordings");
    expect(stderr.split("\n")[0]).toContain("recordings: LOCAL mode");
    expect(stderr).toMatch(/local/i);
    expect(keychainLookups(home)).toEqual([]);
    expect(receipt.leases).toBeGreaterThan(0);
    // The local server may create store DIRECTORIES, never a database.
    expect(existsSync(join(home, ".hasna", "recordings", "recordings.db"))).toBe(false);
  });
});
// The positive env control above must not pass by disabling the Keychain tier.
// A real denied lookup is terminal even when an env credential is available.
(process.platform === "darwin" ? test : test.skip)("MCP keeps a denied Keychain lookup terminal instead of falling through to env", async () => {
  const home = scratchHome("locked");
  const { exitCode, stdout, stderr } = await runMcp(startupFixtureEnv(home, {
    RECORDINGS_TEST_KEYCHAIN_MODE: "locked", HASNA_RECORDINGS_API_KEY: "fixture-mcp-env-key",
  }), ["--stdio"], initializeFrame());
  expect(exitCode).toBe(1);
  expect(stdout).toBe("");
  expect(stderr).toContain("Keychain");
  expect(stderr).toContain("never resolved around");
  expect(stderr).not.toContain("fixture-mcp-env-key");
  expect(keychainLookups(home).some(row => row.mode === "locked")).toBe(true);
});

test("MCP fixture denies every process, fetch and listener boundary", async () => {
  const home = scratchHome("boundary");
  const result = await runStartupFixture(home, [process.execPath, "--preload", PRELOAD, MCP_ENTRY, "--fixture-boundary-probe"], startupFixtureEnv(home));
  expect(result.exitCode, result.stderr).toBe(0);
  expect(JSON.parse(readFileSync(join(home, "mcp-boundary.json"), "utf8"))).toEqual({ platform: process.platform, denied: 14, listeners: 1, leases: 0 });
  expect(keychainLookups(home)).toEqual([]);
});

(process.platform === "darwin" ? test : test.skip)("MCP OS backstop blocks native host tools even without the preload", () => {
  const home = scratchHome("os");
  for (const tool of ["/usr/bin/security", "/usr/bin/defaults", "/usr/bin/open", "/usr/bin/codesign", "/usr/bin/tccutil"]) {
    // --help cannot read or change an owner preference/credential even if the
    // negative control itself regresses. The exact OS denial is required.
    const result = Bun.spawnSync(signingFixtureCommand(home, [tool, "--help"]), { cwd: home, env: startupFixtureEnv(home) });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("Operation not permitted");
  }
});

test("startup supervisor refuses a hung child instead of treating timeout as failed-closed", async () => {
  const home = scratchHome("timeout");
  await expect(runStartupFixture(home, [process.execPath, "-e", "setInterval(() => {}, 1000)"], startupFixtureEnv(home), "", 150)).rejects.toThrow("timed out");
});

test("startup supervisor refuses oversized output", async () => {
  const home = scratchHome("output");
  await expect(runStartupFixture(home, [process.execPath, "-e", 'console.log("x".repeat(70 * 1024))'], startupFixtureEnv(home))).rejects.toThrow("exceeded 64 KiB");
});

(process.platform === "darwin" ? test : test.skip)("MCP OS backstop confines writes and signals to the owned fixture", async () => {
  const home = scratchHome("writes"), outside = scratchHome("outside");
  const script = `import {writeFileSync} from "node:fs";
    writeFileSync(process.argv[1], "owned");
    let writeDenied = false, signalDenied = false;
    try {writeFileSync(process.argv[2], "forbidden");} catch {writeDenied = true;}
    try {process.kill(Number(process.argv[3]), 0);} catch {signalDenied = true;}
    console.log(JSON.stringify({writeDenied, signalDenied}));`;
  const result = await runStartupFixture(home, [process.execPath, "-e", script, join(home, "positive"), join(outside, "negative"), String(process.pid)], startupFixtureEnv(home));
  expect(result.exitCode, result.stderr).toBe(0);
  expect(existsSync(join(home, "positive"))).toBe(true);
  expect(existsSync(join(outside, "negative"))).toBe(false);
  expect(JSON.parse(result.stdout)).toEqual({ writeDenied: true, signalDenied: true });
});
