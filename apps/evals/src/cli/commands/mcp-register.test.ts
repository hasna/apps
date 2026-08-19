import { describe, test, expect, beforeAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Sol-guided coverage (tests-coverage-sol workflow, evals lane):
//   "Test mcp register commands with HOME set to a temporary directory; assert
//    existing mcpServers keys are preserved and the evals entry uses a portable
//    executable resolution rather than the brittle absolute /home/hasna/.bun/bin
//    path. Cover Claude/Codex/Gemini defaults and start spawn with a stub child."
//
// The portable-entry assertion is a regression test for a real defect: the
// shipped entry was the hard-coded absolute path "/home/hasna/.bun/bin/evals-mcp",
// which breaks MCP registration on any machine whose bun global bin lives
// elsewhere. The entry must be a PATH-resolved bare command name instead.

// Path to the CLI entry point (src/cli/index.ts), same pattern as cli.test.ts.
const CLI = join(import.meta.dir, "../index.ts");

async function runCli(args: string[], env: Record<string, string> = {}): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      EVALS_DB_PATH: ":memory:",
      ANTHROPIC_API_KEY: "test-key",
      ...env,
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

interface McpServersConfig {
  mcpServers?: Record<string, { command?: string; args?: unknown[]; type?: string; env?: Record<string, unknown> }>;
}

let homeRoot: string;

beforeAll(() => {
  homeRoot = join(tmpdir(), "evals-mcp-register-" + Date.now());
  mkdirSync(homeRoot, { recursive: true });
});

function freshHome(name: string): string {
  const home = join(homeRoot, name);
  mkdirSync(home, { recursive: true });
  return home;
}

function readConfig(path: string): McpServersConfig {
  expect(existsSync(path)).toBe(true);
  return JSON.parse(readFileSync(path, "utf8")) as McpServersConfig;
}

describe("evals mcp register", () => {
  test("--claude writes a portable evals entry and preserves existing mcpServers keys", async () => {
    const home = freshHome("claude");
    const mcpPath = join(home, ".claude", "mcp.json");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      mcpPath,
      JSON.stringify({ mcpServers: { existing: { command: "some-other-server", args: [] } } }, null, 2) + "\n"
    );

    const { stdout, exitCode } = await runCli(["mcp", "register", "--claude"], { HOME: home });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Registered evals-mcp");

    const config = readConfig(mcpPath);
    // Pre-existing keys must survive the merge — a register that overwrites the
    // whole file would silently disable the user's other MCP servers.
    expect(config.mcpServers!["existing"]).toEqual({ command: "some-other-server", args: [] });

    const entry = config.mcpServers!["evals"];
    expect(entry).toBeDefined();
    // Portable executable resolution: bare command name resolved via PATH.
    expect(entry!.command).toBe("evals-mcp");
    // Never a machine-specific absolute path (regression for the hard-coded
    // /home/hasna/.bun/bin/evals-mcp entry that shipped in this command).
    expect(entry!.command).not.toContain("/home/hasna");
    expect(entry!.command!.startsWith("/")).toBe(false);
    expect(entry!.args).toEqual([]);
  });

  test("default invocation (no flag) registers with Claude Code", async () => {
    const home = freshHome("claude-default");
    const { exitCode } = await runCli(["mcp", "register"], { HOME: home });
    expect(exitCode).toBe(0);
    const config = readConfig(join(home, ".claude", "mcp.json"));
    expect(config.mcpServers!["evals"]).toBeDefined();
  });

  test("--codex writes a stdio entry into ~/.codex/config.json", async () => {
    const home = freshHome("codex");
    const cfgPath = join(home, ".codex", "config.json");
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(cfgPath, JSON.stringify({ mcpServers: { keep: { command: "x", args: [] } } }, null, 2) + "\n");

    const { exitCode } = await runCli(["mcp", "register", "--codex"], { HOME: home });
    expect(exitCode).toBe(0);
    const config = readConfig(cfgPath);
    expect(config.mcpServers!["keep"]).toBeDefined();
    const entry = config.mcpServers!["evals"];
    expect(entry).toBeDefined();
    expect(entry!.type).toBe("stdio");
    expect(entry!.command).toBe("evals-mcp");
    expect(entry!.args).toEqual([]);
    expect(entry!.env).toEqual({});
  });

  test("--gemini writes the evals entry into ~/.gemini/settings.json", async () => {
    const home = freshHome("gemini");
    const cfgPath = join(home, ".gemini", "settings.json");
    mkdirSync(join(home, ".gemini"), { recursive: true });

    const { exitCode } = await runCli(["mcp", "register", "--gemini"], { HOME: home });
    expect(exitCode).toBe(0);
    const config = readConfig(cfgPath);
    const entry = config.mcpServers!["evals"];
    expect(entry).toBeDefined();
    expect(entry!.command).toBe("evals-mcp");
  });

  test("--all registers with all three agents from a fresh HOME", async () => {
    const home = freshHome("all");
    const { exitCode } = await runCli(["mcp", "register", "--all"], { HOME: home });
    expect(exitCode).toBe(0);

    expect(readConfig(join(home, ".claude", "mcp.json")).mcpServers!["evals"]).toBeDefined();
    expect(readConfig(join(home, ".codex", "config.json")).mcpServers!["evals"]).toBeDefined();
    expect(readConfig(join(home, ".gemini", "settings.json")).mcpServers!["evals"]).toBeDefined();
  });
});
