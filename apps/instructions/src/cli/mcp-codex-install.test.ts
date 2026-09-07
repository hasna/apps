import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempRoot } from "../lib/test-temp-root";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const API_URL_ENV = "HASNA_INSTRUCTIONS_API_URL";
const API_KEY_ENV = "HASNA_INSTRUCTIONS_API_KEY";
const LOCAL_OPT_IN_ENV = "HASNA_INSTRUCTIONS_LOCAL";
const DB_PATH_ENV = "HASNA_INSTRUCTIONS_DB_PATH";

/** Every name that can select a hosted transport, for a scrubbed probe. */
const AUTHORITY_SCRUB = [
  API_URL_ENV,
  API_KEY_ENV,
  "INSTRUCTIONS_API_URL",
  "INSTRUCTIONS_API_KEY",
  "HASNA_INSTRUCTIONS_API_KEY_OVERRIDE",
  "HASNA_INSTRUCTIONS_API_KEY_REF",
  "HASNA_PROFILE",
  "HASNA_CONFIGS_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_DATA_HOME",
  "HASNA_STATE_HOME",
  "HASNA_CACHE_HOME",
];

function runCli(args: string[], home: string, dbPath: string) {
  const childEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of AUTHORITY_SCRUB) {
    delete childEnv[key];
  }
  return spawnSync("bun", ["src/cli/index.tsx", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...childEnv,
      HOME: home,
      USER: "tester",
      [LOCAL_OPT_IN_ENV]: "1",
      [DB_PATH_ENV]: dbPath,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
  });
}

/**
 * mcp install/uninstall must be fully reversible for EVERY agent it can write
 * to (regression for the ENOENT crash on a machine with no ~/.codex yet and the
 * missing --codex/--antigravity uninstall paths). All agent config files live
 * under the redirected HOME, and the store is the local opt-in with a throwaway
 * DB, so the probes never touch the machine's real setup.
 */
describe("mcp install/uninstall parity", () => {
  test("codex install creates ~/.codex and uninstall strips only its block", () => {
    const home = makeTempRoot("mcp-codex-");
    const dbPath = join(home, "instructions.db");

    const installed = runCli(["mcp", "install", "--codex"], home, dbPath);
    expect(installed.status).toBe(0);
    expect(installed.stdout).toContain("Installed into Codex");

    const configPath = join(home, ".codex", "config.toml");
    expect(existsSync(configPath)).toBe(true);
    expect(readFileSync(configPath, "utf-8")).toContain("[mcp_servers.configs]");

    // Idempotent second install.
    const again = runCli(["mcp", "install", "--codex"], home, dbPath);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("Already installed in Codex");

    // Other sections must survive uninstall; only the configs block goes.
    writeFileSync(
      configPath,
      `[model]\nprovider = "anthropic"\n\n[mcp_servers.configs]\ncommand = "/configs-mcp"\nargs = []\n\n[mcp_servers.echo]\ncommand = "echo"\n`,
      "utf-8",
    );
    const removed = runCli(["mcp", "uninstall", "--codex"], home, dbPath);
    expect(removed.status).toBe(0);
    expect(removed.stdout).toContain("Removed from Codex");
    const remaining = readFileSync(configPath, "utf-8");
    expect(remaining).not.toContain("mcp_servers.configs");
    expect(remaining).toContain('[model]\nprovider = "anthropic"');
    expect(remaining).toContain("[mcp_servers.echo]");

    // Uninstall is idempotent too.
    const gone = runCli(["mcp", "uninstall", "--codex"], home, dbPath);
    expect(gone.status).toBe(0);
    expect(gone.stdout).toContain("Not installed in Codex");
  });

  test("antigravity install registers and uninstall removes only the configs entry", () => {
    const home = makeTempRoot("mcp-antigravity-");
    const dbPath = join(home, "instructions.db");

    const installed = runCli(["mcp", "install", "--antigravity"], home, dbPath);
    expect(installed.status).toBe(0);
    expect(installed.stdout).toContain("Installed into Antigravity");

    const configPath = join(home, ".gemini", "config", "mcp_config.json");
    expect(existsSync(configPath)).toBe(true);
    const initial = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(initial.mcpServers.configs).toBeDefined();

    // A second server must survive uninstall.
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { configs: initial.mcpServers.configs, echo: { command: "echo" } } }, null, 2) + "\n",
      "utf-8",
    );
    const removed = runCli(["mcp", "uninstall", "--antigravity"], home, dbPath);
    expect(removed.status).toBe(0);
    expect(removed.stdout).toContain("Removed from Antigravity");
    const remaining = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(remaining.mcpServers.configs).toBeUndefined();
    expect(remaining.mcpServers.echo).toBeDefined();
  });
});