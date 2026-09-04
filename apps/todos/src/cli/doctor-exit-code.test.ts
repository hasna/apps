/**
 * `todos doctor` exit-code contract, driven through the REAL CLI.
 *
 * This is the behavioural regression test for the defect where doctor reported
 * healthy on a dataset full of orphans: on the unfixed source every case in
 * "local mode" here fails with `exitCode: 0` and no condition names in stdout,
 * and the remote cases fail because a hardcoded `ok: true` was returned before
 * anything was counted.
 *
 * Contract (see src/cli/doctor-integrity.ts):
 *   0 — clean · 1 — findings · 2 — incomplete (nothing was proven clean)
 *
 * It deliberately imports nothing from the new integrity modules and names the
 * conditions as string literals, so the exact same file can be run against the
 * pre-fix tree to demonstrate the behaviour change.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createTask } from "../db/tasks.js";
import { createTaskList } from "../db/task-lists.js";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

// Each case shells out to the real CLI (cold `bun run` plus a SQLite open), and a
// file-backed database costs seconds on a WAL-slow filesystem.
setDefaultTimeout(120_000);

const CWD = join(import.meta.dir, "../..");
const CONDITION_IDS = [
  "tasks_without_project",
  "tasks_without_task_list",
  "tasks_with_unregistered_project",
  "tasks_with_unregistered_task_list",
  "task_lists_without_project",
  "task_lists_with_unregistered_project",
] as const;

let testRoot = "";
let dirtyDb = "";
let cleanDb = "";

interface CliResult { stdout: string; stderr: string; exitCode: number }

/**
 * Same transient-lock guard cli.test.ts uses: consecutive subprocesses each open
 * their own SQLite/WAL handle, and a busy filesystem can surface SQLITE_BUSY as a
 * "database is locked" failure that has nothing to do with the code under test.
 * Only a lock failure is retried, so a genuine non-zero exit still surfaces.
 */
function isTransientDbLock(result: CliResult): boolean {
  return result.exitCode !== 0 && /database is locked|database table is locked|SQLITE_BUSY/i.test(`${result.stderr}${result.stdout}`);
}

async function runCli(args: string[], dbPath: string, extraEnv: Record<string, string> = {}): Promise<CliResult> {
  let result = await spawnCli(args, dbPath, extraEnv);
  for (let attempt = 1; attempt <= 4 && isTransientDbLock(result); attempt += 1) {
    await Bun.sleep(50 * attempt);
    result = await spawnCli(args, dbPath, extraEnv);
  }
  return result;
}

async function spawnCli(args: string[], dbPath: string, extraEnv: Record<string, string>): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: CWD,
    env: localRoutingTestEnv({
      HOME: join(testRoot, "home"),
      HASNA_EVENTS_DIR: join(testRoot, "events"),
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
      ...extraEnv,
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

/** Seed one row for each of the conditions the live authority was carrying. */
function seedDirtyStore(dbPath: string): void {
  process.env["TODOS_DB_PATH"] = dbPath;
  resetDatabase();
  const db = getDatabase(dbPath);
  const project = createProject({ name: "Registered", path: join(testRoot, "registered") }, db);
  const list = createTaskList({ name: "Registered list", slug: "registered-list", project_id: project.id }, db);
  createTask({ title: "healthy task", project_id: project.id, task_list_id: list.id }, db);
  createTask({ title: "unrouted open task" }, db); // no project_id, no task_list_id

  const ghostProject = createProject({ name: "Ghost", path: join(testRoot, "ghost") }, db);
  const ghostList = createTaskList({ name: "Ghost list", slug: "ghost-list", project_id: ghostProject.id }, db);
  createTask({ title: "dangling task", project_id: ghostProject.id, task_list_id: ghostList.id }, db);
  createTaskList({ name: "Unbound list", slug: "unbound-list" }, db);
  const orphanRefList = createTaskList({ name: "Orphan ref list", slug: "orphan-ref-list" }, db);

  // Remove the referenced rows without letting the SQLite foreign key rewrite the
  // references — the state a foreign-key-less Postgres authority produces.
  db.run("PRAGMA foreign_keys = OFF");
  db.run("DELETE FROM task_lists WHERE id = ?", [ghostList.id]);
  db.run("DELETE FROM projects WHERE id = ?", [ghostProject.id]);
  db.run("UPDATE task_lists SET project_id = ? WHERE id = ?", [ghostProject.id, orphanRefList.id]);
  db.run("PRAGMA foreign_keys = ON");
  closeDatabase();
  resetDatabase();
  delete process.env["TODOS_DB_PATH"];
}

function seedCleanStore(dbPath: string): void {
  process.env["TODOS_DB_PATH"] = dbPath;
  resetDatabase();
  const db = getDatabase(dbPath);
  const project = createProject({ name: "Clean", path: join(testRoot, "clean") }, db);
  const list = createTaskList({ name: "Clean list", slug: "clean-list", project_id: project.id }, db);
  createTask({ title: "clean task", project_id: project.id, task_list_id: list.id }, db);
  closeDatabase();
  resetDatabase();
  delete process.env["TODOS_DB_PATH"];
}

beforeAll(() => {
  testRoot = mkdtempSync(join(tmpdir(), "todos-doctor-exit-"));
  for (const name of ["home", "registered", "ghost", "clean"]) mkdirSync(join(testRoot, name), { recursive: true });
  dirtyDb = join(testRoot, "dirty.db");
  cleanDb = join(testRoot, "clean.db");
  seedDirtyStore(dirtyDb);
  seedCleanStore(cleanDb);
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe("todos doctor exit-code contract (local mode)", () => {
  test("REGRESSION: exits 1 and names every failing condition when orphaned rows exist", async () => {
    const result = await runCli(["doctor"], dirtyDb);

    expect(result.exitCode).toBe(1);
    // Explicit-opt-in local runs no longer emit the legacy todos-local-fallback notice (removed by the fail-closed ruling, hasna/apps#1613): a stderr that still carries it means a stale binary or a regression.
    expect(result.stderr).not.toContain('"event":"todos-local-fallback"');
    for (const id of CONDITION_IDS) expect(result.stdout).toContain(id);
    expect(result.stdout).toContain("Referential integrity");
    expect(result.stdout).not.toContain("All clear");
  });

  test("REGRESSION: --json carries the per-condition breakdown and an honest ok/exit_code", async () => {
    const result = await runCli(["--json", "doctor"], dirtyDb);
    expect(result.exitCode).toBe(1);
    // Explicit-opt-in local runs no longer emit the legacy todos-local-fallback notice (removed by the fail-closed ruling, hasna/apps#1613): a stderr that still carries it means a stale binary or a regression.
    expect(result.stderr).not.toContain('"event":"todos-local-fallback"');

    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      exit_code: number;
      summary: { integrity_findings: number; integrity_rows: number; integrity_unverified: number };
      integrity: {
        summary: { ok: boolean; findings: number; rows: number; unverified: number; complete: boolean };
        conditions: Array<{ id: string; count: number | null; open_count: number | null; severity: string | null; verified: boolean }>;
      };
    };

    expect(report.ok).toBe(false);
    expect(report.exit_code).toBe(1);
    expect(report.integrity.summary).toMatchObject({ ok: false, findings: 6, unverified: 0, complete: true });
    expect(report.summary.integrity_findings).toBe(6);
    expect(report.integrity.conditions.map((condition) => condition.id)).toEqual([...CONDITION_IDS]);
    // The verdict must be derivable from the very counts that were reported.
    const rows = report.integrity.conditions.reduce((total, condition) => total + (condition.count ?? 0), 0);
    expect(rows).toBe(report.integrity.summary.rows);
    expect(report.summary.integrity_rows).toBe(rows);
    // A null reference that still hides open work is an error, not a warning.
    const unrouted = report.integrity.conditions.find((condition) => condition.id === "tasks_without_project")!;
    expect(unrouted).toMatchObject({ count: 1, open_count: 1, severity: "error", verified: true });
  });

  test("exits 0 on a clean store (the mirror case)", async () => {
    const result = await runCli(["doctor"], cleanDb);
    expect(result.exitCode).toBe(0);
    // Explicit-opt-in local runs no longer emit the legacy todos-local-fallback notice (removed by the fail-closed ruling, hasna/apps#1613): a stderr that still carries it means a stale binary or a regression.
    expect(result.stderr).not.toContain('"event":"todos-local-fallback"');
    expect(result.stdout).toContain("Integrity clean");

    const json = await runCli(["--json", "doctor"], cleanDb);
    expect(json.exitCode).toBe(0);
    const report = JSON.parse(json.stdout) as { ok: boolean; exit_code: number; integrity: { summary: { ok: boolean } } };
    expect(report).toMatchObject({ ok: true, exit_code: 0, integrity: { summary: { ok: true } } });
  });

  test("--no-fail-on-findings keeps a legacy consumer green while still reporting the findings", async () => {
    const result = await runCli(["doctor", "--no-fail-on-findings"], dirtyDb);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("tasks_without_project");
    expect(result.stdout).toContain("integrity condition(s) FAILED");
  });

  test("the PRINTED exit code is the one the process returns, even when the gate is suppressed", async () => {
    // A printed `(exit 1)` next to a process that exits 0 is a printed falsehood —
    // the exact defect class this command was fixed for. The findings text stays;
    // the parenthetical must state the real status and name the suppressed verdict.
    const suppressed = await runCli(["doctor", "--no-fail-on-findings"], dirtyDb);
    expect(suppressed.exitCode).toBe(0);
    expect(suppressed.stdout).toContain("(exit 0 — findings gate suppressed by --no-fail-on-findings; the verdict is 1)");
    expect(suppressed.stdout).not.toContain("(exit 1)");

    // Gate active: the printed code and the process status agree at 1.
    const gated = await runCli(["doctor"], dirtyDb);
    expect(gated.exitCode).toBe(1);
    expect(gated.stdout).toContain("(exit 1)");
    expect(gated.stdout).not.toContain("suppressed");

    // The JSON contract carries both numbers, and `exit_code` is the OBSERVED one.
    const suppressedJson = await runCli(["--json", "doctor", "--no-fail-on-findings"], dirtyDb);
    const gatedJson = await runCli(["--json", "doctor"], dirtyDb);
    expect(suppressedJson.exitCode).toBe(0);
    expect(gatedJson.exitCode).toBe(1);
    const parsedSuppressed = JSON.parse(suppressedJson.stdout) as { ok: boolean; exit_code: number; verdict_exit_code: number; fail_on_findings: boolean };
    const parsedGated = JSON.parse(gatedJson.stdout) as { exit_code: number; verdict_exit_code: number; fail_on_findings: boolean };
    expect(parsedSuppressed).toMatchObject({ ok: false, exit_code: 0, verdict_exit_code: 1, fail_on_findings: false });
    expect(parsedGated).toMatchObject({ exit_code: 1, verdict_exit_code: 1, fail_on_findings: true });
    // `exit_code` must equal the status the caller actually observed, in both runs.
    expect(parsedSuppressed.exit_code).toBe(suppressedJson.exitCode);
    expect(parsedGated.exit_code).toBe(gatedJson.exitCode);
  });

  test("--apply never repairs an integrity finding: the counts are identical afterwards", async () => {
    const before = JSON.parse((await runCli(["--json", "doctor"], dirtyDb)).stdout) as
      { integrity: { conditions: Array<{ id: string; count: number | null }> } };
    const applied = await runCli(["--json", "doctor", "--apply"], dirtyDb);
    const after = JSON.parse(applied.stdout) as {
      dry_run: boolean;
      repairs: Array<{ type: string }>;
      integrity: { conditions: Array<{ id: string; count: number | null }> };
    };

    expect(after.dry_run).toBe(false);
    expect(after.integrity.conditions).toEqual(before.integrity.conditions);
    expect(after.repairs.some((repair) => (CONDITION_IDS as readonly string[]).includes(repair.type))).toBe(false);
    expect(applied.exitCode).toBe(1); // repairing schema does not make orphans disappear
  });
});
