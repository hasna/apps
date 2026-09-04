/**
 * Regression tests for round-1 P2 findings:
 *  - P2-12 hooks_setup agent_type passthrough to the installer target
 *  - P2-13 CLI error exit codes (install/info/doctor/docs)
 *  - P2-15 codewith uninstall resolves the operation's own scope
 *  - P2-16a `hooks sync --dry-run` reports dryRun and never claims synced
 *  - P2-16b hooks doctor reports the bounds of its verdict
 */

import { describe, expect, test, beforeEach, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHooksServer } from "../mcp/server.js";
import { closeDb } from "../db/index.js";

const CLI = join(import.meta.dir, "index.tsx");
const TEST_HOME = mkdtempSync(join(tmpdir(), "hooks-p2-test-"));
const SETTINGS_PATH = join(TEST_HOME, ".claude", "settings.json");
const GEMINI_SETTINGS_PATH = join(TEST_HOME, ".gemini", "settings.json");
const CODEWITH_CONFIG = join(TEST_HOME, ".codewith", "config.toml");

const originalClaude = process.env.HASNA_HOOKS_CLAUDE_SETTINGS_PATH;
const originalGemini = process.env.HASNA_HOOKS_GEMINI_SETTINGS_PATH;
const originalCodewith = process.env.HASNA_HOOKS_CODEWITH_CONFIG_PATH;
const originalDataDir = process.env.HASNA_HOOKS_DATA_DIR;
const originalDbPath = process.env.HASNA_HOOKS_DB_PATH;
const originalHome = process.env.HOME;
const originalLocal = process.env.HASNA_HOOKS_LOCAL;

beforeAll(() => {
  process.env.HOME = TEST_HOME;
  process.env.HASNA_HOOKS_CLAUDE_SETTINGS_PATH = SETTINGS_PATH;
  process.env.HASNA_HOOKS_GEMINI_SETTINGS_PATH = GEMINI_SETTINGS_PATH;
  process.env.HASNA_HOOKS_CODEWITH_CONFIG_PATH = CODEWITH_CONFIG;
  process.env.HASNA_HOOKS_DATA_DIR = join(TEST_HOME, "data");
  process.env.HASNA_HOOKS_DB_PATH = join(TEST_HOME, "data", "hooks.db");
  // Explicit local-mode opt-in (fleet fail-closed doctrine): CLI subprocess
  // tests exercise the bundled registry + local store on purpose.
  process.env.HASNA_HOOKS_LOCAL = "1";
});

afterAll(() => {
  const restore = (name: string, original: string | undefined) => {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  };
  restore("HOME", originalHome);
  restore("HASNA_HOOKS_CLAUDE_SETTINGS_PATH", originalClaude);
  restore("HASNA_HOOKS_GEMINI_SETTINGS_PATH", originalGemini);
  restore("HASNA_HOOKS_CODEWITH_CONFIG_PATH", originalCodewith);
  restore("HASNA_HOOKS_DATA_DIR", originalDataDir);
  restore("HASNA_HOOKS_DB_PATH", originalDbPath);
  restore("HASNA_HOOKS_LOCAL", originalLocal);
  closeDb();
  rmSync(TEST_HOME, { recursive: true, force: true });
});

async function run(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("P2-12 hooks_setup agent_type passthrough", () => {
  test("a gemini setup installs into the gemini settings, not the claude settings", async () => {
    const client = new Client({ name: "p2-setup-test", version: "0.0.0" });
    const pair = InMemoryTransport.createLinkedPair();
    const server = createHooksServer();
    await Promise.all([client.connect(pair[0]), (server as any).connect(pair[1])]);
    try {
      const result = await client.callTool({
        name: "hooks_setup",
        arguments: { agent_type: "gemini", name: "p2-gemini-agent" },
      });
      const data = JSON.parse((result.content as any)[0].text);
      expect(data.profile.agent_type).toBe("gemini");
      expect(data.target).toBe("gemini");
      expect(data.installed.length).toBeGreaterThan(0);
      expect(existsSync(GEMINI_SETTINGS_PATH)).toBe(true);
      const geminiSettings = JSON.parse(readFileSync(GEMINI_SETTINGS_PATH, "utf-8"));
      const geminiWiring = JSON.stringify(geminiSettings);
      expect(geminiWiring).toMatch(/hooks run (gitguard|checkpoint|checktests|protectfiles)/);
    } finally {
      await client.close();
      rmSync(GEMINI_SETTINGS_PATH, { force: true });
      rmSync(SETTINGS_PATH, { force: true });
    }
  });

  test("a claude setup (default) still installs into the claude settings", async () => {
    const client = new Client({ name: "p2-setup-test2", version: "0.0.0" });
    const pair = InMemoryTransport.createLinkedPair();
    const server = createHooksServer();
    await Promise.all([client.connect(pair[0]), (server as any).connect(pair[1])]);
    try {
      const result = await client.callTool({
        name: "hooks_setup",
        arguments: { agent_type: "claude", name: "p2-claude-agent" },
      });
      const data = JSON.parse((result.content as any)[0].text);
      expect(data.target).toBe("claude");
      expect(existsSync(SETTINGS_PATH)).toBe(true);
    } finally {
      await client.close();
      rmSync(SETTINGS_PATH, { force: true });
    }
  });
});

describe("P2-13 CLI error exit codes", () => {
  beforeEach(() => {
    rmSync(SETTINGS_PATH, { force: true });
    rmSync(GEMINI_SETTINGS_PATH, { force: true });
    closeDb();
  });

  test("install --category with an unknown category exits nonzero", async () => {
    const res = await run("install", "--category", "NoSuchCategory");
    expect(res.exitCode).toBe(1);
    expect(res.stdout).toMatch(/Unknown category/);
  });

  test("info for an unknown hook exits nonzero", async () => {
    const res = await run("info", "definitely-not-a-hook");
    expect(res.exitCode).toBe(1);
  });

  test("docs for an unknown hook exits nonzero", async () => {
    const res = await run("docs", "definitely-not-a-hook");
    expect(res.exitCode).toBe(1);
  });

  test("doctor with a broken registration exits nonzero and reports its bounds", async () => {
    mkdirSync(TEST_HOME, { recursive: true });
    writeFileSync(SETTINGS_PATH, JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "",
            hooks: [
              { type: "command", command: "hooks run missing-hook" },
              { type: "command", command: "python3 /custom/direct-wire.py" },
            ],
          },
        ],
      },
    }), "utf-8");
    const res = await run("doctor");
    expect(res.exitCode).toBe(1);
    // P2-16b: the verdict names its bounds — registered vs wiring counts.
    expect(res.stdout).toMatch(/registered/);
    expect(res.stdout).toMatch(/wiring/);
    rmSync(SETTINGS_PATH, { force: true });
  });

  test("doctor with everything healthy exits zero and reports the bound line, not a bare claim", async () => {
    const { installHook } = await import("../lib/installer.js");
    installHook("gitguard", { scope: "global", overwrite: true });
    const res = await run("doctor");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).not.toMatch(/All hooks healthy!/);
    expect(res.stdout).toMatch(/All 1 registered hook\(s\) healthy/);
    expect(res.stdout).toMatch(/direct-path wiring outside the registered surface is not covered/);
    rmSync(SETTINGS_PATH, { force: true });
  });

  test("doctor with ZERO registered hooks still reports the bounds line (P3-10)", async () => {
    // Direct-path wiring exists but no `hooks run` entries are registered.
    mkdirSync(TEST_HOME, { recursive: true });
    writeFileSync(SETTINGS_PATH, JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "",
            hooks: [
              { type: "command", command: "python3 /custom/direct-wire.py" },
            ],
          },
        ],
      },
    }), "utf-8");
    const res = await run("doctor");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/No hooks registered/);
    // P3-10: the checked/wiring bound is printed even when nothing is
    // registered — "0 of N wiring entries" is the honest verdict.
    expect(res.stdout).toMatch(/checked 0 registered/);
    expect(res.stdout).toMatch(/1 settings wiring entries/);
    expect(res.stdout).toMatch(/direct-path wiring outside the registered surface is not covered/);
    rmSync(SETTINGS_PATH, { force: true });
  });
});

describe("P2-16a sync --dry-run", () => {
  test("--dry-run reports dry_run:true in JSON and never prints the sync-claimed line", async () => {
    const res = await run("sync", "--dry-run", "--json");
    expect(res.exitCode).toBe(0);
    const body = JSON.parse(res.stdout.trim());
    expect(body.dry_run).toBe(true);
    expect(res.stdout).not.toMatch(/Synced/);
  });

  test("the human dry-run output says dry run and does not claim '✓ Synced'", async () => {
    const res = await run("sync", "--dry-run");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/dry run/i);
    expect(res.stdout).not.toMatch(/✓ Synced/);
  });
});

describe("P2-15 codewith uninstall scope isolation", () => {
  function codewithConfigWith(hookName: string): string {
    return `[[hooks.PreToolUse]]

[[hooks.PreToolUse.hooks]]
type = "command"
command = "hooks run ${hookName}"
timeout = 60000
statusMessage = "Running ${hookName}"
`;
  }

  test("a project-scoped codewith uninstall edits the project config, not the global one", async () => {
    const projectDir = join(TEST_HOME, "proj");
    mkdirSync(join(TEST_HOME, ".codewith"), { recursive: true });
    const globalConfig = join(TEST_HOME, ".codewith", "config.toml");
    const projectConfig = join(projectDir, ".codewith", "config.toml");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(projectDir, ".codewith"), { recursive: true });
    writeFileSync(globalConfig, codewithConfigWith("gitguard"), "utf-8");
    writeFileSync(projectConfig, codewithConfigWith("gitguard"), "utf-8");

    const previousCwd = process.cwd();
    process.chdir(projectDir);
    const { uninstallHook } = await import("../lib/installer.js");
    try {
      const result = uninstallHook("gitguard", "project", "codewith");
      expect(result.removed).toBe(true);
      // Project config is cleaned...
      expect(readFileSync(projectConfig, "utf-8")).not.toMatch(/hooks run gitguard/);
      // ...and the GLOBAL config is untouched (the old hardcoded global path
      // would have edited the wrong file).
      expect(readFileSync(globalConfig, "utf-8")).toMatch(/hooks run gitguard/);
    } finally {
      process.chdir(previousCwd);
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(join(TEST_HOME, ".codewith"), { recursive: true, force: true });
    }
  });
});
