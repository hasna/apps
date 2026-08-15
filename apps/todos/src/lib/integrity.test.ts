/**
 * Regression coverage for the doctor-honesty defect: `todos doctor` reported
 * healthy (`ok: true`, exit 0) on a dataset carrying ten thousand orphaned tasks
 * and forty-five unbound task lists, because neither path ever counted them.
 *
 * Every test in this file fails on the unfixed source: `INTEGRITY_CONDITIONS`,
 * `scanSqliteIntegrity` and `DoctorResult.integrity` did not exist, and
 * `runTodosDoctor` had no notion of an orphaned project / task-list reference.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { scanSqliteIntegrity } from "../db/integrity.js";
import { createProject } from "../db/projects.js";
import { createTask } from "../db/task-crud.js";
import { createTaskList } from "../db/task-lists.js";
import { runTodosDoctor } from "./doctor.js";
import {
  INTEGRITY_CONDITIONS,
  OPEN_TASK_STATUSES,
  adoptRemoteIntegrityReport,
  buildIntegrityReport,
  buildPostgresIntegritySql,
  buildSqliteIntegritySql,
  measureIntegrityRows,
  measuredCondition,
  resolveIntegritySeverity,
  summarizeIntegrity,
  unverifiedCondition,
  type IntegrityConditionSpec,
} from "./integrity.js";

let tempDir: string;
/**
 * In-memory database: a file-backed one costs ~10s per hook on a WAL/fsync-slow
 * box, which blows bun's default hook timeout. The file-backed path is covered
 * end-to-end by the CLI exit-code test, which drives the real binary.
 */
const dbPath = ":memory:";

/** The exact four conditions the live authority was carrying, plus their mirrors. */
const EXPECTED_CONDITION_IDS = [
  "tasks_without_project",
  "tasks_without_task_list",
  "tasks_with_unregistered_project",
  "tasks_with_unregistered_task_list",
  "task_lists_without_project",
  "task_lists_with_unregistered_project",
];

interface SeededOrphans {
  project_id: string;
  list_id: string;
}

/**
 * Seed one row for each condition. Dangling references are produced the way
 * production produces them: the referenced row is removed WITHOUT the SQLite
 * foreign key firing `ON DELETE SET NULL` — which is the normal state of affairs
 * on the Postgres authority, where there are no foreign keys at all.
 */
function seedEveryCondition(db = getDatabase(dbPath)): SeededOrphans {
  const project = createProject({ name: "Registered project", path: join(tempDir, "registered") }, db);
  const list = createTaskList({ name: "Registered list", slug: "registered-list", project_id: project.id }, db);

  // Healthy control row — must never be counted.
  createTask({ title: "bound task", project_id: project.id, task_list_id: list.id }, db);

  // 1 + 2: no project_id, no task_list_id (one still open, one completed, so the
  // open subtotal is exercised too).
  const openOrphan = createTask({ title: "open orphan" }, db);
  const closedOrphan = createTask({ title: "closed orphan" }, db);
  db.run("UPDATE tasks SET status = 'completed' WHERE id = ?", [closedOrphan.id]);

  // 3 + 4: references that point at rows which no longer exist.
  const ghostProject = createProject({ name: "Ghost project", path: join(tempDir, "ghost") }, db);
  const ghostList = createTaskList({ name: "Ghost list", slug: "ghost-list", project_id: ghostProject.id }, db);
  const danglingTask = createTask({ title: "dangling task", project_id: ghostProject.id, task_list_id: ghostList.id }, db);

  // 5 + 6: an unbound task list, and a list pointing at the ghost project. The
  // second one must survive the ghost project's removal, so it is re-pointed
  // inside the same foreign-key-off window.
  createTaskList({ name: "Unbound list", slug: "unbound-list" }, db);
  const orphanList = createTaskList({ name: "Orphan-ref list", slug: "orphan-ref-list" }, db);

  db.run("PRAGMA foreign_keys = OFF");
  db.run("DELETE FROM task_lists WHERE id = ?", [ghostList.id]);
  db.run("DELETE FROM projects WHERE id = ?", [ghostProject.id]);
  db.run("UPDATE task_lists SET project_id = ? WHERE id = ?", [ghostProject.id, orphanList.id]);
  db.run("PRAGMA foreign_keys = ON");

  expect(openOrphan.project_id).toBeNull();
  expect(danglingTask.project_id).toBe(ghostProject.id);
  return { project_id: project.id, list_id: list.id };
}

beforeEach(() => {
  tempDir = join(tmpdir(), `todos-integrity-${crypto.randomUUID()}`);
  for (const name of ["registered", "ghost", "clean"]) mkdirSync(join(tempDir, name), { recursive: true });
  resetDatabase();
  getDatabase(dbPath);
});

afterEach(() => {
  closeDatabase();
  resetDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("integrity condition spec", () => {
  test("declares every condition the live dataset was carrying", () => {
    expect(INTEGRITY_CONDITIONS.map((condition) => condition.id)).toEqual(EXPECTED_CONDITION_IDS);
    expect(new Set(INTEGRITY_CONDITIONS.map((condition) => condition.id)).size).toBe(INTEGRITY_CONDITIONS.length);
  });

  test("derives open statuses from the canonical status list", () => {
    expect([...OPEN_TASK_STATUSES]).toEqual(["pending", "in_progress"]);
  });

  test("renders SQL for BOTH storage engines for every condition (duality gate)", () => {
    for (const spec of INTEGRITY_CONDITIONS) {
      const sqlite = buildSqliteIntegritySql(spec);
      expect(sqlite).toContain("COUNT(*)");
      expect(sqlite).toContain(spec.field);
      const postgres = buildPostgresIntegritySql(spec, { table: "todos_sync_records", service: "todos" });
      expect(postgres.sql).toContain(`/* todos:integrity-${spec.id} */`);
      expect(postgres.sql).toContain(`payload->>'${spec.field}'`);
      // Tombstones must never be reported as live orphans, on either side of the
      // existence check.
      expect(postgres.sql).toContain("t.deleted_at IS NULL");
      if (spec.kind === "dangling") expect(postgres.sql).toContain("r.deleted_at IS NULL");
      // Bun.SQL cannot bind arrays: every value must be an individual $N scalar.
      expect(postgres.params.some((param) => Array.isArray(param))).toBe(false);
      expect(postgres.sql).toContain(`$${postgres.params.length}`);
    }
  });

  test("treats a dangling reference as an error and escalates a null one only when it hides open work", () => {
    const missing = INTEGRITY_CONDITIONS.find((spec) => spec.id === "tasks_without_project")!;
    const dangling = INTEGRITY_CONDITIONS.find((spec) => spec.id === "tasks_with_unregistered_project")!;
    expect(resolveIntegritySeverity(missing, { count: 10, open_count: 0 })).toBe("warn");
    expect(resolveIntegritySeverity(missing, { count: 10, open_count: 1 })).toBe("error");
    expect(resolveIntegritySeverity(dangling, { count: 1, open_count: 0 })).toBe("error");
  });
});

describe("integrity verdict", () => {
  test("can never report ok while ANY condition has matching rows", () => {
    for (const spec of INTEGRITY_CONDITIONS) {
      const conditions = INTEGRITY_CONDITIONS.map((other) =>
        measuredCondition(other, { count: other.id === spec.id ? 1 : 0, open_count: other.entity === "task" ? 0 : null }, "sqlite"));
      const summary = summarizeIntegrity(conditions);
      expect({ id: spec.id, ok: summary.ok, findings: summary.findings, rows: summary.rows })
        .toEqual({ id: spec.id, ok: false, findings: 1, rows: 1 });
    }
  });

  test("reports ok only when every condition was measured AND every count is zero", () => {
    const clean = INTEGRITY_CONDITIONS.map((spec) =>
      measuredCondition(spec, { count: 0, open_count: spec.entity === "task" ? 0 : null }, "sqlite"));
    expect(summarizeIntegrity(clean)).toMatchObject({ ok: true, findings: 0, unverified: 0, complete: true });
  });

  test("an unmeasured condition is never folded into 'all clear'", () => {
    const mixed = INTEGRITY_CONDITIONS.map((spec, index) => index === 0
      ? unverifiedCondition(spec, "authority exposes no aggregate route")
      : measuredCondition(spec, { count: 0, open_count: spec.entity === "task" ? 0 : null }, "sqlite"));
    const summary = summarizeIntegrity(mixed);
    expect(summary).toMatchObject({ ok: false, findings: 0, unverified: 1, complete: false });
    expect(buildIntegrityReport(mixed, "2026-07-27T00:00:00.000Z").summary.ok).toBe(false);
    expect(mixed[0]!.count).toBeNull(); // NOT a zero
  });

  test("the message a condition reports carries the count the verdict is derived from", () => {
    const spec = INTEGRITY_CONDITIONS.find((entry) => entry.id === "tasks_without_project")!;
    const condition = measuredCondition(spec, { count: 10_176, open_count: 4_735 }, "postgres");
    expect(condition.message).toContain("10176");
    expect(condition.message).toContain("4735 still open");
    expect(condition.severity).toBe("error");
    expect(summarizeIntegrity([condition]).rows).toBe(10_176);
  });
});

describe("SQLite integrity scan", () => {
  test("reports every condition as zero on a clean database", () => {
    const db = getDatabase(dbPath);
    const project = createProject({ name: "Clean", path: join(tempDir, "clean") }, db);
    const list = createTaskList({ name: "Clean list", slug: "clean-list", project_id: project.id }, db);
    createTask({ title: "clean task", project_id: project.id, task_list_id: list.id }, db);

    const report = scanSqliteIntegrity(db);
    expect(report.summary).toMatchObject({ ok: true, findings: 0, unverified: 0 });
    expect(report.conditions.map((condition) => condition.count)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(report.conditions.every((condition) => condition.verified && condition.source === "sqlite")).toBe(true);
  });

  test("counts all four live conditions, with the open subtotal, from one query each", () => {
    const db = getDatabase(dbPath);
    seedEveryCondition(db);

    const report = scanSqliteIntegrity(db);
    const byId = new Map(report.conditions.map((condition) => [condition.id, condition]));

    // 2 unrouted tasks (one open, one completed) + the dangling task has a project.
    expect(byId.get("tasks_without_project")).toMatchObject({ count: 2, open_count: 1, severity: "error" });
    expect(byId.get("tasks_without_task_list")).toMatchObject({ count: 2, open_count: 1, severity: "error" });
    expect(byId.get("tasks_with_unregistered_project")).toMatchObject({ count: 1, severity: "error" });
    expect(byId.get("tasks_with_unregistered_task_list")).toMatchObject({ count: 1, severity: "error" });
    // Unbound list + the list pointing at the deleted project.
    expect(byId.get("task_lists_without_project")).toMatchObject({ count: 1, severity: "warn" });
    expect(byId.get("task_lists_with_unregistered_project")).toMatchObject({ count: 1, severity: "error" });

    expect(report.summary).toMatchObject({ ok: false, findings: 6, unverified: 0, complete: true });
    expect(report.summary.rows).toBe(8);
  });

  test("agrees with the in-memory row evaluator on the same dataset (three renderers, one meaning)", () => {
    const db = getDatabase(dbPath);
    seedEveryCondition(db);
    const report = scanSqliteIntegrity(db);

    const tasks = db.query("SELECT project_id, task_list_id, status FROM tasks").all() as Array<{
      project_id: string | null; task_list_id: string | null; status: string;
    }>;
    const taskLists = db.query("SELECT project_id FROM task_lists").all() as Array<{ project_id: string | null }>;
    const sets = {
      tasks,
      taskLists,
      projectIds: new Set((db.query("SELECT id FROM projects").all() as Array<{ id: string }>).map((row) => row.id)),
      taskListIds: new Set((db.query("SELECT id FROM task_lists").all() as Array<{ id: string }>).map((row) => row.id)),
    };

    for (const spec of INTEGRITY_CONDITIONS) {
      const rowMeasurement = measureIntegrityRows(spec, sets);
      const sqlCondition = report.conditions.find((condition) => condition.id === spec.id)!;
      expect({ id: spec.id, ...rowMeasurement }).toEqual({
        id: spec.id,
        count: sqlCondition.count!,
        open_count: sqlCondition.open_count,
      });
    }
  });

  test("cannot measure a condition when the row set is absent, and says so instead of returning zero", () => {
    const taskOnly = INTEGRITY_CONDITIONS.find((spec) => spec.entity === "task")!;
    expect(measureIntegrityRows(taskOnly, { taskLists: [] })).toBeNull();
    const dangling = INTEGRITY_CONDITIONS.find((spec) => spec.kind === "dangling" && spec.entity === "task")!;
    // Rows present but the registered-id denominator missing: still unmeasurable.
    expect(measureIntegrityRows(dangling, { tasks: [{ project_id: "ghost" }] })).toBeNull();
  });
});

describe("local doctor verdict", () => {
  test("reports ok on a clean database", () => {
    const db = getDatabase(dbPath);
    const project = createProject({ name: "Clean", path: join(tempDir, "clean") }, db);
    const list = createTaskList({ name: "Clean list", slug: "clean-list", project_id: project.id }, db);
    createTask({ title: "clean task", project_id: project.id, task_list_id: list.id }, db);

    const result = runTodosDoctor({ db, dbPath, apply: false });
    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({ integrity_findings: 0, integrity_unverified: 0, integrity_rows: 0 });
    expect(result.integrity.conditions).toHaveLength(INTEGRITY_CONDITIONS.length);
  });

  test("REGRESSION: refuses to report ok while orphaned rows exist, and names every condition", () => {
    const db = getDatabase(dbPath);
    seedEveryCondition(db);

    const result = runTodosDoctor({ db, dbPath, apply: false });

    expect(result.ok).toBe(false);
    expect(result.summary.integrity_findings).toBe(6);
    expect(result.summary.integrity_rows).toBe(8);
    const types = result.checks.map((check) => check.type);
    for (const id of EXPECTED_CONDITION_IDS) expect(types).toContain(id);
    // Findings are report-only: doctor must not advertise them as repairable.
    for (const check of result.checks.filter((entry) => entry.integrity)) {
      expect(check.repairable).toBe(false);
    }
  });

  test("--apply repairs schema only and NEVER mutates an integrity finding", () => {
    const db = getDatabase(dbPath);
    seedEveryCondition(db);
    const before = scanSqliteIntegrity(db);

    const applied = runTodosDoctor({ db, dbPath, apply: true });

    const after = scanSqliteIntegrity(db);
    expect(after.conditions.map((condition) => [condition.id, condition.count]))
      .toEqual(before.conditions.map((condition) => [condition.id, condition.count]));
    expect(applied.repairs.every((repair) => !INTEGRITY_CONDITIONS.some((spec) => spec.id === repair.type))).toBe(true);
    expect(applied.ok).toBe(false); // still not healthy — the rows are still there
  });

  test("a condition that cannot be measured keeps the verdict unhealthy", () => {
    const db = getDatabase(dbPath);
    db.run("PRAGMA foreign_keys = OFF");
    db.run("DROP TABLE task_lists");

    const report = scanSqliteIntegrity(db);
    expect(report.summary).toMatchObject({ ok: false, complete: false });
    expect(report.conditions.every((condition) => condition.count === null)).toBe(true);
    expect(report.conditions[0]!.unverified_reason).toContain("task_lists");
  });
});

describe("adopting a report from another process", () => {
  test("recomputes the verdict from the counts and ignores a claimed summary", () => {
    const adopted = adoptRemoteIntegrityReport({
      generated_at: "2026-07-27T00:00:00.000Z",
      source: "postgres",
      conditions: [
        { id: "tasks_without_project", count: 10_176, open_count: 4_735, verified: true, severity: null },
      ],
      // A lie that used to be believed verbatim.
      summary: { ok: true, findings: 0, rows: 0, errors: 0, warnings: 0, unverified: 0, complete: true },
    } as never, "2026-07-27T00:00:00.000Z");

    expect(adopted.summary).toMatchObject({ ok: false, findings: 1, rows: 10_176, errors: 1 });
    expect(adopted.source).toBe("postgres");
    // Missing conditions become unverified rather than shrinking the checked set.
    expect(adopted.conditions).toHaveLength(INTEGRITY_CONDITIONS.length);
    expect(adopted.summary.unverified).toBe(INTEGRITY_CONDITIONS.length - 1);
    expect(adopted.conditions.find((condition) => condition.id === "task_lists_without_project"))
      .toMatchObject({ count: null, verified: false });
  });

  test("rejects an unusable count and an unknown condition id", () => {
    const adopted = adoptRemoteIntegrityReport({
      conditions: [
        { id: "tasks_without_project", count: "many", verified: true },
        { id: "tasks_without_task_list", count: 3, verified: false, unverified_reason: "backend timeout" },
        { id: "a_condition_this_build_does_not_know", count: 99, verified: true },
      ],
    } as never, "2026-07-27T00:00:00.000Z");

    expect(adopted.summary).toMatchObject({ ok: false, findings: 0, unverified: INTEGRITY_CONDITIONS.length });
    expect(adopted.conditions.map((condition) => condition.id)).toEqual(INTEGRITY_CONDITIONS.map((spec) => spec.id));
    expect(adopted.conditions.find((condition) => condition.id === "tasks_without_task_list")?.unverified_reason)
      .toBe("backend timeout");
  });
});

describe("condition spec hygiene", () => {
  test("every condition documents its operator impact", () => {
    for (const spec of INTEGRITY_CONDITIONS satisfies readonly IntegrityConditionSpec[]) {
      expect(spec.impact.length).toBeGreaterThan(20);
      expect(["project", "task_list"]).toContain(spec.target);
    }
  });
});
