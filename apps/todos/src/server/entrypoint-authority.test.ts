import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function syntheticEnv(root: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: root,
    TMPDIR: root,
    LANG: "C.UTF-8",
    TODOS_DB_PATH: join(root, "todos.db"),
    TODOS_AUTO_PROJECT: "false",
    ...extra,
  };
}

function expectNoSqliteArtifacts(root: string): void {
  expect(readdirSync(root).filter((name) => /(?:\.db|\.sqlite)(?:-|$)/.test(name))).toEqual([]);
}

async function runOperatorCommand(
  command: "migrate" | "redact-comments",
  args: string[] = [],
) {
  const root = mkdtempSync(join(tmpdir(), "todos-operator-floor-"));
  tempRoots.push(root);
  const proc = Bun.spawn(["bun", "run", "src/server/index.ts", command, ...args], {
    cwd: REPO_ROOT,
    env: syntheticEnv(root, {
      HASNA_TODOS_STORAGE_MODE: "local",
      HASNA_TODOS_DATABASE_URL: "postgres://synthetic.invalid/todos",
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const result = await Promise.race([
    proc.exited.then((exitCode) => ({ exitCode, timedOut: false })),
    Bun.sleep(3_000).then(() => ({ exitCode: -1, timedOut: true })),
  ]);
  if (result.timedOut) proc.kill();
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { ...result, stdout, stderr, dbExists: existsSync(join(root, "todos.db")), root };
}

describe("todos-serve Stage-A entrypoint containment", () => {
  test.each(["migrate", "redact-comments"] as const)(
    "%s fails before cloud import, client construction, or SQLite",
    async (command) => {
      const result = await runOperatorCommand(command);
      expect(result.timedOut).toBe(false);
      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(result.stderr).not.toContain("at runMigrate");
      expect(result.stderr).not.toContain("at runCommentRedactionBackfill");
      expect(result.stderr).not.toContain("src/server/index.ts:");
      expect(result.dbExists).toBe(false);
      expectNoSqliteArtifacts(result.root);
    },
  );

  test.each([
    ["global", ["--json"]],
    ["operator plus invalid batch", ["--batch-size", "12junk", "--json"]],
  ] as const)(
    "redact-comments emits one stable JSON floor for %s flag placement before batch parsing",
    async (_label, args) => {
      const result = await runOperatorCommand("redact-comments", [...args]);
      expect(result.timedOut).toBe(false);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        error: "hosted_authority_unavailable",
        code: "HOSTED_AUTHORITY_UNAVAILABLE",
        reason: "authority_resolver_unavailable",
      });
      expect(result.dbExists).toBe(false);
      expectNoSqliteArtifacts(result.root);
    },
  );

  test("hosted startup resolves authority before port probing, listener setup, or swallowed listener errors", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-serve-floor-"));
    tempRoots.push(root);
    const preload = join(REPO_ROOT, "src/test/stage-a-entrypoint-preload.ts");
    const proc = Bun.spawn([
      "bun", "--preload", preload, "src/server/index.ts",
    ], {
      cwd: REPO_ROOT,
      env: syntheticEnv(root, {
        HASNA_TODOS_STORAGE_MODE: "remote",
      }),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdoutPromise = new Response(proc.stdout).text();
    const stderrPromise = new Response(proc.stderr).text();
    const result = await Promise.race([
      proc.exited.then((exitCode) => ({ exitCode, timedOut: false })),
      Bun.sleep(3_000).then(() => ({ exitCode: -1, timedOut: true })),
    ]);
    if (result.timedOut) {
      proc.kill();
    }
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    expect(result.timedOut, `${stdout}\n${stderr}`).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(`${stdout}\n${stderr}`).toContain("HOSTED_AUTHORITY_UNAVAILABLE");
    expect(stderr).toContain("STAGE_A_SYNTHETIC_SERVE_CALLS=0");
    expect(`${stdout}\n${stderr}`).not.toContain("STAGE_A_ENTRYPOINT_TRIPWIRE");
    expect(existsSync(join(root, "todos.db"))).toBe(false);
    expectNoSqliteArtifacts(root);
  });
});
