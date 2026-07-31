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
import { join } from "node:path";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

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
  return { exitCode, stdout, stderr };
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
      mcpServers: {
        "plugin-telegram-telegram": { command: "telegram-mcp" },
      },
    }));

    const registered = await runCli(["mcp", "--register", "cursor"], fixtureRoot);

    expect(registered.exitCode).toBe(0);
    expect(registered.stderr).toBe("");
    expect(registered.stdout).toContain("Cursor (project): registered");
    expect(readJson(configPath)).toEqual({
      mcpServers: {
        "plugin-telegram-telegram": { command: "telegram-mcp" },
        todos: { command: fixtureRoot.mcpBinary, args: ["--stdio"] },
      },
    });

    const unregistered = await runCli(["mcp", "--unregister", "cursor"], fixtureRoot);

    expect(unregistered.exitCode).toBe(0);
    expect(readJson(configPath)).toEqual({
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
