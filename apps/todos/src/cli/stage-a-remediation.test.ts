import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runCli(
  args: string[],
  mode: string = "local",
  extraEnv: Record<string, string> = {},
) {
  const root = mkdtempSync(join(tmpdir(), "todos-stage-a-cli-"));
  tempRoots.push(root);
  const dbPath = join(root, "todos.db");
  const result = Bun.spawnSync(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_STORAGE_MODE: mode,
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    dbExists: existsSync(dbPath),
    sqliteArtifacts: readdirSync(root).filter((name) => /(?:\.db|\.sqlite)(?:-|$)/.test(name)),
  };
}

function expectStableJsonFloor(
  result: ReturnType<typeof runCli>,
  reason = "explicit_hosted",
): void {
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    error: "hosted_authority_unavailable",
    code: "HOSTED_AUTHORITY_UNAVAILABLE",
    reason,
  });
}

function expectStableJsonError(
  result: ReturnType<typeof runCli>,
  error: string,
): void {
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.trim().split("\n")).toHaveLength(1);
  expect(JSON.parse(result.stdout)).toEqual({ error });
}

describe("Stage-A CLI remediation contracts", () => {
  test.each(["local", "remote"])(
    "advertised help [command] renders known command help in %s mode without SQLite",
    (mode) => {
      const result = runCli(["help", "list"], mode);
      const canonical = runCli(["list", "--help"], mode);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(canonical.stdout);
      expect(result.stdout).toContain("Usage: todos list");
      expect(result.sqliteArtifacts).toEqual([]);
    },
  );

  test("help accepts a generated nested command path without loading runtime state", () => {
    const result = runCli(["help", "storage", "status"], "remote");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: todos storage status");
    expect(result.sqliteArtifacts).toEqual([]);
  });

  test.each([
    ["global short flag", ["-j", "list"]],
    ["global long flag", ["--json", "list"]],
    ["subcommand flag", ["list", "--json"]],
  ] as const)("%s emits one parseable JSON floor and no plain text", (_label, args) => {
    const result = runCli([...args], "remote");
    expectStableJsonFloor(result);
    expect(result.dbExists).toBe(false);
  });

  test.each([
    ["invalid positive integer, global short JSON", ["-j", "dispatches", "--limit", "0"], "--limit must be a positive integer"],
    ["invalid positive integer, subcommand long JSON", ["dispatches", "--limit", "0", "--json"], "--limit must be a positive integer"],
    ["invalid runtime integer, global long JSON", ["--json", "list", "--limit", "0"], "--limit must be a positive integer"],
    ["invalid runtime integer, subcommand short JSON", ["list", "--limit", "0", "-j"], "--limit must be a positive integer"],
    ["unknown option, global long JSON", ["--json", "list", "--definitely-unknown"], "unknown option '--definitely-unknown'"],
    ["unknown option, subcommand short JSON", ["list", "--definitely-unknown", "-j"], "unknown option '--definitely-unknown'"],
    ["missing option value, global long JSON", ["--json", "list", "--limit"], "option '--limit <n>' argument missing"],
    ["missing option value, subcommand short JSON", ["list", "-j", "--limit"], "option '--limit <n>' argument missing"],
    ["invalid action, global long JSON", ["--json", "bulk", "nope", "synthetic-id"], "Unknown action: nope. Use: done, start, delete, plan"],
    ["invalid action, subcommand short JSON", ["bulk", "nope", "synthetic-id", "-j"], "Unknown action: nope. Use: done, start, delete, plan"],
  ] as const)("serializes %s through one deterministic JSON error path", (_label, args, message) => {
    expectStableJsonError(runCli([...args]), message);
  });

  test.each([
    ["subcommand JSON", ["storage", "shadow-drain", "--json"]],
    ["global JSON", ["--json", "storage", "shadow-drain"]],
  ] as const)("shadow-drain reaches the unconditional floor before config or SQLite: %s", (_label, args) => {
    const result = runCli([...args], "local");
    expectStableJsonFloor(result, "authority_resolver_unavailable");
    expect(result.dbExists).toBe(false);
    expect(result.sqliteArtifacts).toEqual([]);
  });

  test.each([
    ["local without config", "local", {}, "authority_resolver_unavailable"],
    ["local with shadow intent", "local", {
      HASNA_TODOS_SHADOW: "1",
      HASNA_TODOS_DATABASE_URL: "postgres://synthetic.invalid/todos",
    }, "authority_resolver_unavailable"],
    ["remote", "remote", {}, "explicit_hosted"],
    ["remote with DSN", "remote", {
      HASNA_TODOS_DATABASE_URL: "postgres://synthetic.invalid/todos",
    }, "explicit_hosted"],
    ["hybrid", "hybrid", {}, "explicit_hosted"],
    ["invalid", "not-a-mode", {}, "invalid_mode"],
  ] as const)("shadow-drain performs zero SQLite work for %s", (_label, mode, extraEnv, reason) => {
    const result = runCli(["--json", "storage", "shadow-drain"], mode, extraEnv);
    expectStableJsonFloor(result, reason);
    expect(result.sqliteArtifacts).toEqual([]);
  });

  test.each([
    "12junk",
    "12.0",
    "+12",
    " 12",
    "12 ",
    "01",
    "0",
    "-1",
    "9007199254740992",
  ])("public list --limit rejects non-canonical positive-safe integer syntax: %j", (value) => {
    const result = runCli(["list", "--limit", value, "--json"]);
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("--limit must be a positive integer");
  });

  test("public list --limit preserves a normal canonical value", () => {
    const result = runCli(["list", "--limit", "12", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([]);
  });

  test.each([
    ["task duration", ["add", "synthetic task", "--estimated", "12junk", "--json"], "--estimated"],
    ["storage limit", ["storage", "artifacts", "upload", "--limit", "01", "--json"], "--limit"],
  ] as const)("%s rejects non-canonical integer syntax through the public CLI", (_label, args, flag) => {
    const result = runCli([...args]);
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(`${flag} must be a positive integer`);
  });

  test("shadow timeout parsing cannot precede the unconditional Stage-A floor", () => {
    const result = runCli([
      "storage", "shadow-drain", "--timeout", "12junk", "--json",
    ]);
    expectStableJsonFloor(result, "authority_resolver_unavailable");
    expect(result.sqliteArtifacts).toEqual([]);
  });
});
