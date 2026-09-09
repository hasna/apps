import { afterEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { runStartupFixture, startupFixtureEnv } from "./helpers/startup-fixture";
import { VERSION } from "../version.js";

// The `recordings-mcp` binary (`bin` entry -> dist/mcp/index.js, bundled from
// src/mcp/index.ts) must answer --version / -V and --help / -h WITHOUT binding
// an HTTP port. Before this suite existed, main() only handled --stdio and
// otherwise called startMcpHttpServer() unconditionally, so on a fleet station
// whose MCP port band (8870-8878) is occupied by a running instance the binary
// died with EADDRINUSE rc=1 on `--version` (measured on the installed 0.2.14),
// and on a free port it bound-and-hung instead of printing a version. Sibling
// MCPs (repos-mcp, prompts-mcp, sessions-mcp) answer --version correctly.
//
// The entry is spawned as source (process.execPath + src/mcp/index.ts), the
// same convention as trigger-diagnosis.test.ts; build:mcp bundles this exact
// entry into dist/mcp/index.js. Each spawn is bounded so that a regression to
// bind-before-arg-handling fails the suite with a clear timeout instead of
// hanging it.

const temporaryHomes: string[] = [];
afterEach(() => { for (const home of temporaryHomes.splice(0)) rmSync(home, { recursive: true, force: true }); });

async function runMcp(args: string[]) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "recordings-mcp-options-")));
  chmodSync(home, 0o700); temporaryHomes.push(home);
  const result = await runStartupFixture(home, [process.execPath, "--preload",
    join(import.meta.dir, "helpers/mcp-startup-preload.ts"), join(import.meta.dir, "../mcp/index.ts"), ...args],
    startupFixtureEnv(home, { RECORDINGS_TEST_KEYCHAIN_MODE: "locked" }));
  // Help/version must precede both credential resolution and transport startup.
  expect(JSON.parse(readFileSync(join(home, "mcp-boundary.json"), "utf8"))).toEqual({
    platform: process.platform, denied: 0, listeners: 0, leases: 0,
  });
  expect(existsSync(join(home, "keychain-fixture.jsonl"))).toBe(false);
  return result;
}

describe("recordings-mcp argument handling", () => {
  test("--version prints the package version and exits without binding a port", async () => {
    const result = await runMcp(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
    // A process that bound the HTTP port would still be running (the
    // station03 hang shape) or would have died EADDRINUSE (the fleet shape) —
    // either way it would not have exited 0 having printed only the version.
    expect(result.stderr).not.toContain("HTTP listening");
  });

  test("-V prints the package version and exits without binding a port", async () => {
    const result = await runMcp(["-V"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
    expect(result.stderr).not.toContain("HTTP listening");
  });

  test("--help prints usage and exits without binding a port", async () => {
    const result = await runMcp(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage");
    expect(result.stdout).toContain("--stdio");
    expect(result.stdout).toContain("--port");
    expect(result.stderr).not.toContain("HTTP listening");
  });

  test("-h prints usage and exits without binding a port", async () => {
    const result = await runMcp(["-h"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage");
    expect(result.stderr).not.toContain("HTTP listening");
  });
});
