import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const PRELOAD = join(REPO_ROOT, "src/test/stage-a-entrypoint-preload.ts");

function runEntrypoint(
  entry: string,
  args: readonly string[],
  mode: "local" | "remote" = "remote",
) {
  const root = mkdtempSync(join(tmpdir(), "todos-stage-a-entrypoint-"));
  try {
    const result = Bun.spawnSync(["bun", "--preload", PRELOAD, join(REPO_ROOT, entry), ...args], {
      cwd: root,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: root,
        TMPDIR: root,
        LANG: "C.UTF-8",
        TODOS_DB_PATH: join(root, "todos.db"),
        TODOS_AUTO_PROJECT: "false",
        HASNA_TODOS_STORAGE_MODE: mode,
        TODOS_STORAGE_MODE: mode,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      files: readdirSync(root),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function expectNoRuntime(result: ReturnType<typeof runEntrypoint>): void {
  expect(result.stderr).toContain("STAGE_A_SYNTHETIC_SERVE_CALLS=0");
  expect(`${result.stdout}\n${result.stderr}`).not.toContain("STAGE_A_ENTRYPOINT_TRIPWIRE");
  expect(result.files.filter((name) => /(?:\.db|\.sqlite)(?:-|$)/.test(name))).toEqual([]);
}

describe("dependency-light exact entrypoint metadata grammar", () => {
  test.each([
    ["todos help", "src/cli/index.tsx", ["--help"], /Usage: todos/],
    ["todos version", "src/cli/index.tsx", ["--version"], /^\d+\.\d+\.\d+/m],
    ["todos empty argv", "src/cli/index.tsx", [], /Usage: todos/],
    ["todos-mcp help", "src/mcp/index.ts", ["--help"], /Usage: todos-mcp/],
    ["todos-mcp version", "src/mcp/index.ts", ["--version"], /^\d+\.\d+\.\d+/m],
    ["todos-serve help", "src/server/index.ts", ["--help"], /Usage: todos-serve/],
    ["todos-serve version", "src/server/index.ts", ["--version"], /^\d+\.\d+\.\d+/m],
  ] as const)("renders %s without importing a runtime graph", (_label, entry, args, expected) => {
    const result = runEntrypoint(entry, args);
    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(expected);
    expectNoRuntime(result);
  });

  test.each([
    ["todos help plus extra", "src/cli/index.tsx", ["--help", "extra"]],
    ["todos option only", "src/cli/index.tsx", ["--json"]],
    ["todos-mcp help plus extra", "src/mcp/index.ts", ["--help", "extra"]],
    ["todos-mcp version plus transport", "src/mcp/index.ts", ["--version", "--stdio"]],
    ["todos-mcp missing port", "src/mcp/index.ts", ["--port"]],
    ["todos-mcp unknown option", "src/mcp/index.ts", ["--unknown"]],
    ["todos-serve help plus extra", "src/server/index.ts", ["--help", "extra"]],
    ["todos-serve version plus port", "src/server/index.ts", ["--version", "--port", "19427"]],
    ["todos-serve missing host", "src/server/index.ts", ["--host"]],
    ["todos-serve option only", "src/server/index.ts", ["--json"]],
    ["todos-serve unknown option", "src/server/index.ts", ["--unknown"]],
  ] as const)("fails closed for %s before runtime or listener work", (_label, entry, args) => {
    const result = runEntrypoint(entry, args, "local");
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("HOSTED_AUTHORITY_UNAVAILABLE");
    expectNoRuntime(result);
  });

  test.each([
    ["todos-mcp empty argv", "src/mcp/index.ts"],
    ["todos-serve empty argv", "src/server/index.ts"],
  ] as const)("%s reaches the process authority floor before listener or transport work", (_label, entry) => {
    const result = runEntrypoint(entry, [], "remote");
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("HOSTED_AUTHORITY_UNAVAILABLE");
    expectNoRuntime(result);
  });
});
