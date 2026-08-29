import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempHome: string | null = null;

function testEnvironment(): NodeJS.ProcessEnv {
  tempHome ??= mkdtempSync(join(tmpdir(), "terminal-cli-"));
  return {
    PATH: process.env.PATH,
    HOME: tempHome,
    HASNA_TERMINAL_DB_PATH: join(tempHome, "sessions.db"),
    TERMINAL_DB_PATH: join(tempHome, "sessions.db"),
  };
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, ["src/cli.tsx", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: testEnvironment(),
  });
}

afterEach(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
  tempHome = null;
});

describe("CLI gradual disclosure", () => {
  test("snapshot is compact by default and full JSON when requested", () => {
    const compact = runCli(["snapshot"]);
    expect(compact.status).toBe(0);
    expect(compact.stdout).toContain("Snapshot:");
    expect(compact.stdout.trim().startsWith("{")).toBe(false);
    expect(compact.stdout).toContain("snapshot --json");

    const json = runCli(["snapshot", "--json"]);
    expect(json.status).toBe(0);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.cwd).toBe(process.cwd());
    expect(parsed.env).toBeDefined();
  });

  test("recipe list is compact and recipe show discloses details", () => {
    const list = runCli(["recipe", "list", "--limit=2"]);
    expect(list.status).toBe(0);
    expect(list.stdout).toContain("Showing 2");
    expect(list.stdout).toContain("recipe show <name>");

    const show = runCli(["recipe", "show", "find-todos"]);
    expect(show.status).toBe(0);
    expect(show.stdout).toContain("Recipe: find-todos");
    expect(show.stdout).toContain("grep -rn");
  });

  test("sessions list advertises detail and machine-readable paths", () => {
    const result = runCli(["sessions", "--limit=1"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Use sessions show <id>");
    expect(result.stdout).toContain("--json");
  });

  test("symbols directory output is globally bounded", () => {
    const result = runCli(["symbols", "src", "--limit=20"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("symbols shown");
    expect(result.stdout).toContain("Showing at most 20 symbols");
    expect(result.stdout.split("\n").length).toBeLessThan(80);
    expect(result.stdout.length).toBeLessThan(6000);
  });
});

describe("events command group routing (O15-04797 regression)", () => {
  test("channels command group is advertised and functional", () => {
    const help = runCli(["channels", "--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("channels");
    expect(help.stdout).not.toContain("Unknown command group");
  });

  test("legacy webhooks alias routes to the channels group instead of failing", () => {
    const help = runCli(["webhooks", "--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("channels");
    expect(help.stdout).not.toContain("Unknown command group");
  });

  test("top-level --help advertises channels, not the removed webhooks group", () => {
    const help = runCli(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("channels");
    expect(help.stdout).not.toContain("webhooks");
  });
});
