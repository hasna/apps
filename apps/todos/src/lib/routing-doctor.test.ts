import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { listComments } from "../db/comments.js";
import { createProject } from "../db/projects.js";
import { createTaskList } from "../db/task-lists.js";
import { createTask, getTask } from "../db/tasks.js";
import {
  classifyTaskRouting,
  detectCrossRepoIntent,
  routingRepairUndoCommand,
  routingShardOf,
  runRoutingDoctor,
  TODOS_ROUTING_DOCTOR_SCHEMA_VERSION,
} from "./routing-doctor.js";

let tempDir: string;
let dbPath: string;
let repoDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `todos-routing-doctor-${crypto.randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  dbPath = join(tempDir, "todos.db");
  repoDir = join(tempDir, "open-todos");
  mkdirSync(repoDir, { recursive: true });
  process.env["TODOS_DB_PATH"] = dbPath;
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  resetDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

/** Create a project with a resolvable canonical task list at `repoDir`. */
function projectWithList(name: string, path: string) {
  const db = getDatabase();
  const project = createProject({ name, path }, db);
  // project.task_list_id is a slug like `todos-<name>`; make it resolvable.
  const list = createTaskList({ name: `${name} list`, slug: project.task_list_id!, project_id: project.id }, db);
  return { project, list };
}

/**
 * Simulate a task whose task_list_id references no task list. The tasks FK to
 * task_lists.id is enforced, so this legacy/dangling state is reproduced with the
 * same PRAGMA foreign_keys=OFF pattern the local doctor tests use.
 */
function setDanglingTaskList(taskId: string, slug: string) {
  const db = getDatabase();
  db.run("PRAGMA foreign_keys = OFF");
  db.run("UPDATE tasks SET task_list_id = ? WHERE id = ?", [slug, taskId]);
  db.run("PRAGMA foreign_keys = ON");
}

describe("routing doctor — detection", () => {
  test("clean database with correct routing metadata yields no findings", () => {
    const db = getDatabase();
    const { project, list } = projectWithList("OpenTodos", repoDir);
    createTask({ title: "healthy task", project_id: project.id, task_list_id: list.id, working_dir: repoDir, tags: ["auto:route"] }, db);

    const result = runRoutingDoctor({ db, dbPath });

    expect(result.schema_version).toBe(TODOS_ROUTING_DOCTOR_SCHEMA_VERSION);
    expect(result.ok).toBe(true);
    expect(result.summary.findings_total).toBe(0);
    expect(result.summary.inspected).toBe(1);
    expect(result.dry_run).toBe(true);
  });

  test("detects wrong working_dir as a safe_auto repair pointing to the owning project", () => {
    const db = getDatabase();
    const { project, list } = projectWithList("OpenTodos", repoDir);
    const task = createTask({ title: "drifted", project_id: project.id, task_list_id: list.id, working_dir: tempDir, tags: ["auto:route"] }, db);

    const result = runRoutingDoctor({ db, dbPath });
    const finding = result.findings.find((f) => f.category === "wrong_working_dir");

    expect(finding).toBeDefined();
    expect(finding!.task_id).toBe(task.id);
    expect(finding!.repair_class).toBe("safe_auto");
    expect(finding!.suggested_repair).toMatchObject({ field: "working_dir", from: tempDir, to: repoDir });
    expect(finding!.suggested_repair!.command).toContain(`--working-dir ${repoDir}`);
  });

  test("detects null working_dir as safe_auto", () => {
    const db = getDatabase();
    const { project, list } = projectWithList("OpenTodos", repoDir);
    createTask({ title: "no wd", project_id: project.id, task_list_id: list.id, tags: ["auto:route"] }, db);

    const result = runRoutingDoctor({ db, dbPath });
    const finding = result.findings.find((f) => f.category === "null_working_dir");
    expect(finding?.repair_class).toBe("safe_auto");
    expect(finding?.suggested_repair?.to).toBe(repoDir);
  });

  test("does not flag a worktree working_dir as drift", () => {
    const db = getDatabase();
    const { project, list } = projectWithList("OpenTodos", repoDir);
    createTask({ title: "in worktree", project_id: project.id, task_list_id: list.id, working_dir: `${repoDir}/.codewith/worktrees/abc`, tags: ["auto:route"] }, db);

    const result = runRoutingDoctor({ db, dbPath });
    expect(result.findings.some((f) => f.category === "wrong_working_dir")).toBe(false);
  });

  test("detects null task_list_id and relinks by the canonical UUID", () => {
    const db = getDatabase();
    const { project, list } = projectWithList("OpenTodos", repoDir);
    const task = createTask({ title: "no list", project_id: project.id, working_dir: repoDir, tags: ["auto:route"] }, db);

    const result = runRoutingDoctor({ db, dbPath });
    const finding = result.findings.find((f) => f.category === "null_task_list_id" && f.task_id === task.id);
    expect(finding?.repair_class).toBe("safe_auto");
    expect(finding?.suggested_repair).toMatchObject({ field: "task_list_id", from: null, to: list.id });
  });

  test("null task_list_id with no resolvable project list is unsupported (not guessed)", () => {
    const db = getDatabase();
    // Project WITHOUT a matching task-list row -> canonical slug resolves to nothing.
    const project = createProject({ name: "NoList", path: repoDir }, db);
    createTask({ title: "orphan list", project_id: project.id, working_dir: repoDir, tags: ["auto:route"] }, db);

    const result = runRoutingDoctor({ db, dbPath });
    const finding = result.findings.find((f) => f.category === "null_task_list_id");
    expect(finding?.repair_class).toBe("unsupported");
    expect(finding?.suggested_repair).toBeNull();
  });

  test("detects an unresolvable task_list_id slug and relinks to the canonical UUID", () => {
    const db = getDatabase();
    const { project, list } = projectWithList("OpenTodos", repoDir);
    const task = createTask({ title: "bad list ref", project_id: project.id, task_list_id: list.id, working_dir: repoDir, tags: ["auto:route"] }, db);
    setDanglingTaskList(task.id, "todos-open-backup");

    const result = runRoutingDoctor({ db, dbPath });
    const finding = result.findings.find((f) => f.category === "unresolvable_task_list" && f.task_id === task.id);
    expect(finding?.repair_class).toBe("safe_auto");
    expect(finding?.suggested_repair?.to).toBe(list.id);
  });

  test("unresolvable slug with no canonical list is a human blocker (reported, not guessed)", () => {
    const db = getDatabase();
    const project = createProject({ name: "NoList", path: repoDir }, db);
    const task = createTask({ title: "dangling", project_id: project.id, working_dir: repoDir, tags: ["auto:route"] }, db);
    setDanglingTaskList(task.id, "todos-vanished");

    const result = runRoutingDoctor({ db, dbPath });
    const finding = result.findings.find((f) => f.category === "unresolvable_task_list");
    expect(finding?.repair_class).toBe("blocker_human");
    expect(finding?.suggested_repair).toBeNull();
  });

  test("flags an invalid (missing) project path as a blocker and never auto-repairs it", () => {
    const db = getDatabase();
    const missing = join(tempDir, "open-transcriber"); // never created on disk
    const project = createProject({ name: "OpenTranscriber", path: missing }, db);
    const badList = createTaskList({ name: "t", slug: project.task_list_id!, project_id: project.id }, db);
    createTask({ title: "missing repo", project_id: project.id, task_list_id: badList.id, working_dir: missing, tags: ["auto:route"] }, db);

    const result = runRoutingDoctor({ db, dbPath });
    const finding = result.findings.find((f) => f.category === "invalid_project_path");
    expect(finding).toBeDefined();
    expect(finding!.repair_class).toBe("blocker_invalid_path");
    expect(result.summary.safe_auto).toBe(0);
  });

  test("invalid_project_path is suppressed when project-root verification is off", () => {
    const db = getDatabase();
    const missing = join(tempDir, "open-transcriber");
    const project = createProject({ name: "OpenTranscriber", path: missing }, db);
    const badList = createTaskList({ name: "t", slug: project.task_list_id!, project_id: project.id }, db);
    createTask({ title: "missing repo", project_id: project.id, task_list_id: badList.id, working_dir: missing, tags: ["auto:route"] }, db);

    const result = runRoutingDoctor({ db, dbPath, verifyProjectRoot: false });
    expect(result.findings.some((f) => f.category === "invalid_project_path")).toBe(false);
    expect(result.scope.verify_project_root).toBe(false);
  });

  test("detects cross-repo intent and refuses to auto-repair working_dir", () => {
    const db = getDatabase();
    const bridgeDir = join(tempDir, "open-bridge");
    const codewithDir = join(tempDir, "open-codewith");
    mkdirSync(bridgeDir, { recursive: true });
    mkdirSync(codewithDir, { recursive: true });
    projectWithList("open-codewith", codewithDir); // makes open-codewith a KNOWN repo slug
    const { project, list } = projectWithList("open-bridge", bridgeDir);
    createTask({ title: "Wire up the open-codewith daemon", project_id: project.id, task_list_id: list.id, working_dir: tempDir, tags: ["auto:route"] }, db);

    const result = runRoutingDoctor({ db, dbPath });
    const finding = result.findings.find((f) => f.category === "wrong_working_dir");
    expect(finding?.repair_class).toBe("blocker_cross_repo");
    expect(finding?.suggested_repair).toBeNull();
  });

  test("does not false-positive cross-repo when the title names its own repo", () => {
    const db = getDatabase();
    const codewithDir = join(tempDir, "open-codewith");
    mkdirSync(codewithDir, { recursive: true });
    projectWithList("open-todos", repoDir);
    const { project, list } = projectWithList("open-codewith", codewithDir);
    createTask({ title: "make open-codewith read the open-todos doctor", project_id: project.id, task_list_id: list.id, working_dir: codewithDir, tags: ["auto:route"] }, db);

    const result = runRoutingDoctor({ db, dbPath });
    expect(result.findings.some((f) => f.category === "cross_repo_intent")).toBe(false);
  });

  test("flags an auto:route + no-auto contradiction as a human blocker", () => {
    const db = getDatabase();
    const { project, list } = projectWithList("OpenTodos", repoDir);
    createTask({ title: "conflicted", project_id: project.id, task_list_id: list.id, working_dir: repoDir, tags: ["auto:route", "no-auto"] }, db);

    const result = runRoutingDoctor({ db, dbPath });
    const finding = result.findings.find((f) => f.category === "no_auto_conflict");
    expect(finding?.repair_class).toBe("blocker_human");
  });

  test("flags route_not_enabled when a tag-opted-in task carries an explicit route_enabled:false", () => {
    const db = getDatabase();
    const { project, list } = projectWithList("OpenTodos", repoDir);
    createTask({ title: "explicit deny", project_id: project.id, task_list_id: list.id, working_dir: repoDir, tags: ["auto:route"], metadata: { route_enabled: false } }, db);

    const result = runRoutingDoctor({ db, dbPath });
    const finding = result.findings.find((f) => f.category === "route_not_enabled");
    expect(finding?.repair_class).toBe("blocker_human");
  });
});

describe("routing doctor — safe repair (--apply)", () => {
  test("applies only safe_auto repairs, comments evidence, writes an undo record and a backup, and leaves blockers untouched", () => {
    const db = getDatabase();
    const { project, list } = projectWithList("OpenTodos", repoDir);
    const drifted = createTask({ title: "drifted", project_id: project.id, task_list_id: list.id, working_dir: tempDir, tags: ["auto:route"] }, db);
    const noList = createTask({ title: "no list", project_id: project.id, working_dir: repoDir, tags: ["auto:route"] }, db);
    // A blocker that must NOT be touched.
    const missing = join(tempDir, "open-transcriber");
    const badProject = createProject({ name: "OpenTranscriber", path: missing }, db);
    const badList = createTaskList({ name: "t", slug: badProject.task_list_id!, project_id: badProject.id }, db);
    const blocked = createTask({ title: "missing repo", project_id: badProject.id, task_list_id: badList.id, working_dir: missing, tags: ["auto:route"] }, db);

    const undoPath = join(tempDir, "undo.json");
    const result = runRoutingDoctor({ db, dbPath, apply: true, actor: "routing-doctor-test", undoRecordPath: undoPath });

    // safe repairs applied
    expect(result.dry_run).toBe(false);
    expect(result.summary.repaired).toBeGreaterThanOrEqual(2);
    expect(getTask(drifted.id, db)?.working_dir).toBe(repoDir);
    expect(getTask(noList.id, db)?.task_list_id).toBe(list.id);
    // blocker left untouched
    expect(getTask(blocked.id, db)?.working_dir).toBe(missing);
    // evidence comment on a repaired task
    const comments = listComments(drifted.id, db);
    expect(comments.some((c) => c.content.includes("[routing-doctor] repaired working_dir") && c.content.includes(repoDir))).toBe(true);
    // undo record + backup
    expect(existsSync(undoPath)).toBe(true);
    const undo = JSON.parse(readFileSync(undoPath, "utf8"));
    expect(undo.repairs.length).toBeGreaterThanOrEqual(2);
    // undo commands must be REAL: value-origin repairs restore the old value,
    // null-origin repairs use the explicit clear flags (never a falsy '' no-op).
    const wdUndo = undo.repairs.find((r: any) => r.task_id === drifted.id && r.field === "working_dir");
    expect(wdUndo.undo_command).toBe(`todos update ${drifted.id} --working-dir ${tempDir}`);
    const listUndo = undo.repairs.find((r: any) => r.task_id === noList.id && r.field === "task_list_id");
    expect(listUndo.from).toBeNull();
    expect(listUndo.undo_command).toBe(`todos update ${noList.id} --clear-list`);
    expect(undo.repairs.every((r: any) => !r.undo_command.includes("''"))).toBe(true);
    expect(result.backup?.path).toBeDefined();
    // residual findings still include the untouched blocker
    expect(result.summary.by_repair_class["blocker_invalid_path"]).toBeGreaterThanOrEqual(1);
  });

  test("dry-run never mutates", () => {
    const db = getDatabase();
    const { project, list } = projectWithList("OpenTodos", repoDir);
    const drifted = createTask({ title: "drifted", project_id: project.id, task_list_id: list.id, working_dir: tempDir, tags: ["auto:route"] }, db);

    runRoutingDoctor({ db, dbPath, apply: false });
    expect(getTask(drifted.id, db)?.working_dir).toBe(tempDir);
    expect(listComments(drifted.id, db)).toHaveLength(0);
  });
});

describe("routing doctor — sharding & scope", () => {
  test("routingShardOf is stable and keeps a project together", () => {
    const a = routingShardOf({ id: "t1", project_id: "p1" }, 4);
    const b = routingShardOf({ id: "t2", project_id: "p1" }, 4);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(4);
    expect(routingShardOf({ id: "x", project_id: "p1" }, 1)).toBe(0);
  });

  test("sharded runs partition the task set without overlap or loss", () => {
    const db = getDatabase();
    for (let i = 0; i < 6; i++) {
      const dir = join(tempDir, `p${i}`);
      mkdirSync(dir, { recursive: true });
      const { project, list } = projectWithList(`P${i}`, dir);
      createTask({ title: `t${i}`, project_id: project.id, task_list_id: list.id, working_dir: tempDir, tags: ["auto:route"] }, db);
    }
    const total = runRoutingDoctor({ db, dbPath }).summary.inspected;
    let sharded = 0;
    for (let i = 0; i < 3; i++) sharded += runRoutingDoctor({ db, dbPath, shardIndex: i, shardTotal: 3 }).summary.inspected;
    expect(sharded).toBe(total);
    const shard0 = runRoutingDoctor({ db, dbPath, shardIndex: 0, shardTotal: 3 });
    expect(shard0.scope.shard).toEqual({ index: 0, total: 3 });
  });

  test("classifyTaskRouting is callable directly for a single task", () => {
    const db = getDatabase();
    const { project, list } = projectWithList("OpenTodos", repoDir);
    const task = createTask({ title: "drifted", project_id: project.id, task_list_id: list.id, working_dir: tempDir, tags: ["auto:route"] }, db);
    const findings = classifyTaskRouting({ task, project, db, knownRepoSlugs: new Set(["open-todos"]), verifyProjectRoot: true });
    expect(findings.some((f) => f.category === "wrong_working_dir")).toBe(true);
  });
});

describe("routing doctor — undo command unit", () => {
  test("value-origin repairs restore the prior value", () => {
    expect(routingRepairUndoCommand({ task_id: "t1", field: "working_dir", from: "/old/path" })).toBe("todos update t1 --working-dir /old/path");
    expect(routingRepairUndoCommand({ task_id: "t2", field: "task_list_id", from: "list-uuid" })).toBe("todos update t2 --list list-uuid");
  });

  test("null-origin repairs use the explicit clear flags, never a falsy '' no-op", () => {
    expect(routingRepairUndoCommand({ task_id: "t3", field: "working_dir", from: null })).toBe("todos update t3 --clear-working-dir");
    expect(routingRepairUndoCommand({ task_id: "t4", field: "task_list_id", from: null })).toBe("todos update t4 --clear-list");
  });
});

describe("routing doctor — cross-repo detector unit", () => {
  const project = { id: "p", name: "open-bridge", path: "/x/open-bridge", description: null, task_list_id: null, task_prefix: null, task_counter: 0, created_at: "", updated_at: "" } as any;
  const known = new Set(["open-bridge", "open-codewith"]);

  test("flags a foreign, known repo named in the title", () => {
    expect(detectCrossRepoIntent({ title: "fix open-codewith", tags: [] }, project, known)).toBe("open-codewith");
  });
  test("does not flag when the title also names its own repo", () => {
    expect(detectCrossRepoIntent({ title: "fix open-bridge and open-codewith", tags: [] }, project, known)).toBeNull();
  });
  test("does not flag generic titles or unknown repo names", () => {
    expect(detectCrossRepoIntent({ title: "generic work", tags: [] }, project, known)).toBeNull();
    expect(detectCrossRepoIntent({ title: "touch open-unknownrepo", tags: [] }, project, known)).toBeNull();
  });
});
