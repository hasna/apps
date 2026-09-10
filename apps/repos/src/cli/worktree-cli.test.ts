/**
 * The two shape properties the worktree verbs rest on, asserted against the
 * real CLI rather than against the library.
 *
 * A reviewer can read `worktrees.ts` and see that the path is computed. What
 * they cannot see from there is whether some later commit adds `--path` to the
 * command for convenience. These tests fail if it does.
 *
 * Every case here is refused before the canonical worktree root is ever
 * consulted, so nothing is created under the live root that other agents are
 * working in.
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb } from "../db/database.js";

setDefaultTimeout(30_000);

let tempDir = "";

afterEach(() => {
  closeDb();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
});

function seedDb(): string {
  tempDir = mkdtempSync(join(tmpdir(), "repos-worktree-cli-"));
  const dbPath = join(tempDir, "repos.db");
  getDb(dbPath);
  closeDb();
  return dbPath;
}

/**
 * Registry fixture for the all-numeric-name defect (todos
 * 12ed8c6d-910b-4824-891d-ea5d7edc9c25): GitHub permits an all-numeric
 * repository name, so row id=9 carries the NAME "2048" while a DIFFERENT row
 * holds the id 2048. An input of "2048" must resolve to the name row — never
 * be silently coerced into the id and land on 'infra-legacy'.
 */
function seedNumericNameDb(): string {
  const dbPath = seedDb();
  const db = getDb(dbPath);
  // Both rows carry an org so the failure reaches the parent-checkout check;
  // the org-nested layout refuses a row with no org before opening the parent.
  db.query("INSERT INTO repos (id, path, name, org) VALUES (2048, '/tmp/infra-legacy', 'infra-legacy', 'hasna')").run();
  db.query("INSERT INTO repos (id, path, name, org) VALUES (9, '/tmp/numeric-2048', '2048', 'hasna')").run();
  closeDb();
  return dbPath;
}

function runCli(dbPath: string, args: string[], env: Record<string, string> = {}) {
  const result = Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.tsx", ...args],
    cwd: join(import.meta.dir, "../.."),
    env: { ...process.env, HASNA_REPOS_AUTO_BOOTSTRAP: "0", HASNA_REPOS_DB_PATH: dbPath, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function errorOf(stdout: string): { code: string; message: string } {
  return (JSON.parse(stdout) as { error: { code: string; message: string } }).error;
}

describe("repos worktree — argument surface", () => {
  test("the verb exists at all", () => {
    // The owner's premise, checked rather than assumed: `repos --help` on the
    // Published 0.1.37 lists no worktree verb. This asserts the next package does.
    const dbPath = seedDb();
    const help = runCli(dbPath, ["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("worktree");
  });

  test("`worktree add` exposes no way to name a destination", () => {
    const dbPath = seedDb();
    const help = runCli(dbPath, ["worktree", "add", "--help"]);
    expect(help.code).toBe(0);
    for (const forbidden of ["--path", "--dir", "--target", "--destination", "--worktree-root", "--root", "--org"]) {
      expect(help.stdout).not.toContain(forbidden);
    }
    // The org segment is computed from the registry row, and the help says
    // where the worktree lands rather than leaving it to be discovered.
    expect(help.stdout).toContain("<root>/<org>/<repo>/<worktree>");
    // The options that do exist are the ones that feed the computation.
    expect(help.stdout).toContain("--task");
    expect(help.stdout).toContain("--name");
  });

  test("`worktree remove` takes a reference, and rejects every path shape", () => {
    const dbPath = seedDb();
    const help = runCli(dbPath, ["worktree", "remove", "--help"]);
    expect(help.stdout).toContain("<ref>");
    expect(help.stdout).not.toContain("--path");

    for (const path of [
      "/home/hasna/.hasna/repos/worktrees/hasna/repos/a321ba13",
      "/etc",
      "../../etc",
      "~/.hasna",
      "./local",
      "org/repo/name/extra",
      "org//name",
      "../repo/name",
    ]) {
      const result = runCli(dbPath, ["worktree", "remove", path, "--json"]);
      expect(result.code).toBe(1);
      expect(errorOf(result.stdout).code).toBe("INVALID_REQUEST");
    }
  });

  test("`worktree remove` accepts the fully qualified <org>/<repo>/<worktree> reference by shape", () => {
    // Three plain segments name exactly one canonical path under the root
    // (owner ruling 2026-09-10: `<root>/<org>/<repo>/<worktree>`), so the
    // reference passes shape validation and is refused only because nothing
    // is there. The root is redirected into the fixture so the live root is
    // never consulted.
    const dbPath = seedDb();
    const result = runCli(dbPath, ["worktree", "remove", "hasna/repos/a321ba13", "--json"], {
      HASNA_REPOS_HOME: join(tempDir, "repos-home"),
    });
    expect(result.code).toBe(1);
    expect(errorOf(result.stdout).code).toBe("LEASE_NOT_FOUND");
    expect(errorOf(result.stdout).message).toContain("hasna/repos/a321ba13");
  });

  test("a crafted worktree name is refused by the CLI, not just by the library", () => {
    const dbPath = seedDb();
    const result = runCli(dbPath, ["worktree", "add", "open-anything", "--name", "../../escape", "--json"]);
    expect(result.code).toBe(1);
    expect(errorOf(result.stdout).code).toBe("INVALID_WORKTREE_NAME");
  });

  test("an all-numeric repo NAME resolves by name, never silently as a registry id", () => {
    // Regression for todos 12ed8c6d-910b-4824-891d-ea5d7edc9c25: "2048" is the
    // NAME of the id=9 row, while id=2048 belongs to 'infra-legacy'. The
    // resolution must reach the name row and report THAT checkout, not coerce
    // "2048" into the id and blame 'infra-legacy'.
    const dbPath = seedNumericNameDb();
    const result = runCli(dbPath, ["worktree", "add", "2048", "--name", "wt1", "--json"]);
    expect(result.code).toBe(1);
    expect(errorOf(result.stdout).code).toBe("PARENT_CHECKOUT_BROKEN");
    expect(errorOf(result.stdout).message).toContain("'2048'");
    expect(errorOf(result.stdout).message).not.toContain("infra-legacy");
  });

  test("an unregistered repo is reported, never guessed at", () => {
    const dbPath = seedDb();
    const result = runCli(dbPath, ["worktree", "add", "open-not-registered", "--task", "abc123", "--json"]);
    expect(result.code).toBe(1);
    expect(errorOf(result.stdout).code).toBe("REPO_NOT_FOUND");
  });

  test("`worktree remove` is callable by a scheduled loop: a dry run and a JSON payload", () => {
    // Requirement 3 of the owner directive — "built so a scheduled loop can call
    // it later without reshaping it" — asserted at the surface a loop actually
    // invokes, because a library-only capability is not one a cron line can use.
    const dbPath = seedDb();
    const help = runCli(dbPath, ["worktree", "remove", "--help"]);
    expect(help.stdout).toContain("--dry-run");
    expect(help.stdout).toContain("--json");
    // The unlanded hazard gets its own opt-in, and the help says so rather than
    // leaving an operator to discover it from a refusal.
    expect(help.stdout).toContain("--allow-unlanded");
  });

  test("`worktree adopt` is the only verb that accepts a path, and defaults to a dry run", () => {
    const dbPath = seedDb();
    const help = runCli(dbPath, ["worktree", "adopt", "--help"]);
    expect(help.stdout).toContain("[path]");
    expect(help.stdout).toContain("--apply");
    expect(help.stdout).toContain("dry run");
  });
});

test("normalize exposes reviewed dry runs and rollback, but no destination override", () => {
  const dbPath = seedDb();
  const help = runCli(dbPath, ["worktree", "normalize", "--help"]);
  expect(help.code).toBe(0);
  for (const flag of ["--name", "--dry-run", "--apply", "--expected-plan-hash", "--rollback"]) expect(help.stdout).toContain(flag);
  for (const flag of ["--path", "--destination", "--target", "--root"]) expect(help.stdout).not.toContain(flag);
  const result = runCli(dbPath, ["worktree", "normalize", "hasna/repos", "--name", "../escape", "--json"]);
  expect(result.code).toBe(1); expect(errorOf(result.stdout).code).toBe("INVALID_WORKTREE_NAME");
});
