import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";
import { projectExternalBunDuplicatePackageWarning } from "../test/bun-fixture-isolation.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): { home: string; workspace: string; mcpBinary: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), "todos-cursor-mcp-"));
  roots.push(root);
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const binDir = join(root, "bin");
  const mcpBinary = join(binDir, "todos-mcp");
  mkdirSync(home, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(mcpBinary, "#!/bin/sh\nexit 0\n");
  chmodSync(mcpBinary, 0o755);
  return {
    home,
    workspace,
    mcpBinary,
    path: `${binDir}:${process.env["PATH"] ?? ""}`,
  };
}

async function runCli(
  args: string[],
  options: { home: string; workspace: string; path: string },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(
    [process.execPath, "run", join(import.meta.dir, "index.tsx"), ...args],
    {
      cwd: options.workspace,
      env: localRoutingTestEnv({
        HOME: options.home,
        PATH: options.path,
        TODOS_AUTO_PROJECT: "false",
      }),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const projected = projectExternalBunDuplicatePackageWarning(stderr);
  return { exitCode, stdout, stderr: projected.stderr };
}

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
}

describe("Cursor MCP registration", () => {
  test("registers and unregisters todos in the project config without removing other servers", async () => {
    const fixtureRoot = fixture();
    const configPath = join(fixtureRoot.workspace, ".cursor", "mcp.json");
    mkdirSync(join(fixtureRoot.workspace, ".cursor"), { recursive: true });
    writeFileSync(configPath, JSON.stringify({
      // A sibling top-level key: registration must rewrite mcpServers without
      // discarding unrelated Cursor project configuration around it.
      projectSetting: true,
      mcpServers: {
        "plugin-telegram-telegram": { command: "telegram-mcp" },
      },
    }));

    const registered = await runCli(["mcp", "--register", "cursor"], fixtureRoot);

    expect(registered.exitCode).toBe(0);
    // Explicit-opt-in local runs no longer emit the legacy todos-local-fallback notice (removed by the fail-closed ruling, hasna/apps#1613): a stderr that still carries it means a stale binary or a regression.
    expect(registered.stderr).not.toContain('"event":"todos-local-fallback"');
    expect(registered.stdout).toContain("Cursor (project): registered");
    expect(readJson(configPath)).toEqual({
      projectSetting: true,
      mcpServers: {
        "plugin-telegram-telegram": { command: "telegram-mcp" },
        todos: { command: fixtureRoot.mcpBinary, args: ["--stdio"] },
      },
    });

    const unregistered = await runCli(["mcp", "--unregister", "cursor"], fixtureRoot);

    expect(unregistered.exitCode).toBe(0);
    expect(readJson(configPath)).toEqual({
      projectSetting: true,
      mcpServers: {
        "plugin-telegram-telegram": { command: "telegram-mcp" },
      },
    });
  }, 30_000);

  test("uses Cursor's user config for global registration", async () => {
    const fixtureRoot = fixture();
    const globalConfigPath = join(fixtureRoot.home, ".cursor", "mcp.json");
    const projectConfigPath = join(fixtureRoot.workspace, ".cursor", "mcp.json");

    const registered = await runCli(
      ["mcp", "--register", "cursor", "--global"],
      fixtureRoot,
    );

    expect(registered.exitCode).toBe(0);
    expect(registered.stdout).toContain("Cursor (user): registered");
    expect(readJson(globalConfigPath)).toEqual({
      mcpServers: {
        todos: { command: fixtureRoot.mcpBinary, args: ["--stdio"] },
      },
    });
    expect(existsSync(projectConfigPath)).toBe(false);
  }, 30_000);
});

// Takumi manages MCP config through its own `takumi mcp add/remove` CLI (like
// Claude Code), so registration shells out to it. The fake binary records its
// argv so the exact invocation is asserted, not just the exit code.
function installFakeTakumi(fixtureRoot: { mcpBinary: string }): string {
  const binDir = dirname(fixtureRoot.mcpBinary);
  const callLog = join(binDir, "takumi-calls.log");
  const takumiBin = join(binDir, "takumi");
  writeFileSync(takumiBin, `#!/bin/sh\necho "$@" >> "${callLog}"\n`);
  chmodSync(takumiBin, 0o755);
  return callLog;
}

function readCalls(callLog: string): string[] {
  return readFileSync(callLog, "utf8").trim().split("\n");
}

describe("Takumi MCP registration", () => {
  // Regression for the shipped adapter-doc metadata instructing agents to run
  // `todos mcp --register takumi`: on 0.15.12 that returned
  // "Unknown agent: takumi. Use: claude, codex, gemini, cursor, all".
  test("registers and unregisters todos via the takumi CLI at project scope", async () => {
    const fixtureRoot = fixture();
    const callLog = installFakeTakumi(fixtureRoot);

    const registered = await runCli(["mcp", "--register", "takumi"], fixtureRoot);

    expect(registered.exitCode).toBe(0);
    // Explicit-opt-in local runs no longer emit the legacy todos-local-fallback notice (removed by the fail-closed ruling, hasna/apps#1613): a stderr that still carries it means a stale binary or a regression.
    expect(registered.stderr).not.toContain('"event":"todos-local-fallback"');
    expect(registered.stdout).not.toContain("Unknown agent");
    expect(registered.stdout).toContain("Takumi (project): registered");
    expect(readCalls(callLog)).toEqual([
      `mcp add --scope project todos -- ${fixtureRoot.mcpBinary} --stdio`,
    ]);

    const unregistered = await runCli(["mcp", "--unregister", "takumi"], fixtureRoot);

    expect(unregistered.exitCode).toBe(0);
    // Explicit-opt-in local runs no longer emit the legacy todos-local-fallback notice (removed by the fail-closed ruling, hasna/apps#1613): a stderr that still carries it means a stale binary or a regression.
    expect(unregistered.stderr).not.toContain('"event":"todos-local-fallback"');
    expect(unregistered.stdout).toContain("Takumi (project): removed todos MCP server");
    expect(readCalls(callLog)).toEqual([
      `mcp add --scope project todos -- ${fixtureRoot.mcpBinary} --stdio`,
      "mcp remove --scope project todos",
    ]);
  }, 30_000);

  test("registers and unregisters at user scope with --global", async () => {
    const fixtureRoot = fixture();
    const callLog = installFakeTakumi(fixtureRoot);

    const registered = await runCli(
      ["mcp", "--register", "takumi", "--global"],
      fixtureRoot,
    );

    expect(registered.exitCode).toBe(0);
    // Explicit-opt-in local runs no longer emit the legacy todos-local-fallback notice (removed by the fail-closed ruling, hasna/apps#1613): a stderr that still carries it means a stale binary or a regression.
    expect(registered.stderr).not.toContain('"event":"todos-local-fallback"');
    expect(registered.stdout).toContain("Takumi (user): registered");
    expect(readCalls(callLog)).toEqual([
      `mcp add --scope user todos -- ${fixtureRoot.mcpBinary} --stdio`,
    ]);

    const unregistered = await runCli(
      ["mcp", "--unregister", "takumi", "--global"],
      fixtureRoot,
    );

    expect(unregistered.exitCode).toBe(0);
    // Explicit-opt-in local runs no longer emit the legacy todos-local-fallback notice (removed by the fail-closed ruling, hasna/apps#1613): a stderr that still carries it means a stale binary or a regression.
    expect(unregistered.stderr).not.toContain('"event":"todos-local-fallback"');
    expect(unregistered.stdout).toContain("Takumi (user): removed todos MCP server");
    expect(readCalls(callLog)).toEqual([
      `mcp add --scope user todos -- ${fixtureRoot.mcpBinary} --stdio`,
      "mcp remove --scope user todos",
    ]);
  }, 30_000);
});
