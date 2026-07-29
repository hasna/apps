import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

const CWD = join(import.meta.dir, "../..");
const AMBIGUOUS_SHORT_ID = "DUP-00001";
const TIMEOUT = 30_000;

let tmpDir: string;
let dbPath: string;
let fakeHome: string;
let projectIds: string[];
let taskIds: string[];

function run(args: string[]) {
  return spawnSync("bun", ["run", "src/cli/index.tsx", ...args], {
    cwd: CWD,
    encoding: "utf8",
    timeout: TIMEOUT,
    env: localRoutingTestEnv({
      HOME: fakeHome,
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
    }),
  });
}

function runJson(args: string[]): any {
  const result = run(["--json", ...args]);
  if (result.status !== 0) {
    throw new Error(`command failed: ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout.trim());
}

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "todos-ambiguous-task-ref-"));
  dbPath = join(tmpDir, "todos.db");
  fakeHome = join(tmpDir, "home");
  await mkdir(join(fakeHome, ".hasna", "todos"), { recursive: true });

  // Initialize the schema, then create the same human short ID in two projects.
  runJson(["count"]);
  const firstProject = runJson(["projects", "--add", join(tmpDir, "first"), "--name", "Duplicate First"]);
  const secondProject = runJson(["projects", "--add", join(tmpDir, "second"), "--name", "Duplicate Second"]);
  const firstTask = runJson(["add", "First project task", "--project", firstProject.id]);
  const secondTask = runJson(["add", "Second project task", "--project", secondProject.id]);

  projectIds = [firstProject.id, secondProject.id];
  taskIds = [firstTask.id, secondTask.id];

  const db = new Database(dbPath);
  try {
    // Legacy/synced tasks can legitimately share a short ID across source
    // machines. Their project UUIDs are the context needed to disambiguate.
    db.run("UPDATE tasks SET short_id = ?, machine_id = ? WHERE id = ?", [AMBIGUOUS_SHORT_ID, "source-one", firstTask.id]);
    db.run("UPDATE tasks SET short_id = ?, machine_id = ? WHERE id = ?", [AMBIGUOUS_SHORT_ID, "source-two", secondTask.id]);
  } finally {
    db.close();
  }
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("ambiguous project-scoped task short IDs", () => {
  const commands: Array<[string, string[]]> = [
    ["show", ["show", AMBIGUOUS_SHORT_ID]],
    ["inspect", ["inspect", AMBIGUOUS_SHORT_ID]],
    ["update", ["update", AMBIGUOUS_SHORT_ID, "--title", "wrong task"]],
    ["comment", ["comment", AMBIGUOUS_SHORT_ID, "must not be recorded"]],
    ["start", ["start", AMBIGUOUS_SHORT_ID]],
    ["done", ["done", AMBIGUOUS_SHORT_ID]],
    ["verification", ["record-verification", AMBIGUOUS_SHORT_ID, "bun test", "--status", "passed"]],
  ];

  for (const [name, args] of commands) {
    test(`${name} fails closed and reports candidate project IDs`, () => {
      const result = run(["--json", ...args]);
      expect(result.status).toBe(1);
      const error = JSON.parse(result.stdout.trim()) as { error: string };
      expect(error.error).toContain(`Task reference is ambiguous: "${AMBIGUOUS_SHORT_ID}"`);
      expect(error.error).toContain("Candidate project IDs:");
      for (const projectId of projectIds) expect(error.error).toContain(projectId);
      expect(error.error).toContain("Use a full task UUID");
    }, TIMEOUT);
  }

  test("ambiguous commands do not read or mutate either candidate", () => {
    const db = new Database(dbPath);
    try {
      const tasks = db.query(
        "SELECT id, title, status, started_at, completed_at FROM tasks WHERE id IN (?, ?) ORDER BY id",
      ).all(...taskIds) as Array<Record<string, unknown>>;
      expect(tasks).toHaveLength(2);
      expect(tasks.map((task) => task.title).sort()).toEqual(["First project task", "Second project task"]);
      expect(tasks.every((task) => task.status === "pending")).toBe(true);
      expect(tasks.every((task) => task.started_at === null && task.completed_at === null)).toBe(true);
      expect((db.query("SELECT COUNT(*) AS count FROM task_comments WHERE task_id IN (?, ?)").get(...taskIds) as { count: number }).count).toBe(0);
      expect((db.query("SELECT COUNT(*) AS count FROM task_verifications WHERE task_id IN (?, ?)").get(...taskIds) as { count: number }).count).toBe(0);
    } finally {
      db.close();
    }
  });

  test("a full UUID remains authoritative when short IDs collide", () => {
    const task = runJson(["show", taskIds[0]!]);
    expect(task.id).toBe(taskIds[0]);
    expect(task.project_id).toBe(projectIds[0]);
  }, TIMEOUT);
});
