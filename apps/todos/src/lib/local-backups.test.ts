import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addComment } from "../db/comments.js";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createPlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import { createTaskList } from "../db/task-lists.js";
import { createTask, getTask, listTasks } from "../db/tasks.js";
import { addTaskRunArtifact, addTaskRunCommand, startTaskRun, verifyTaskRunArtifacts } from "../db/task-runs.js";
import { resetConfig } from "./config.js";
import {
  TODOS_LOCAL_BACKUP_KIND,
  checkLocalIntegrity,
  createLocalBackup,
  readLocalBackupFile,
  restoreLocalBackup,
  verifyLocalBackup,
  writeLocalBackupFile,
} from "./local-backups.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "todos-local-backups-"));
  process.env["TODOS_DB_PATH"] = ":memory:";
  process.env["HASNA_TODOS_ARTIFACTS_DIR"] = join(root, "artifacts");
  resetConfig();
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  delete process.env["HASNA_TODOS_ARTIFACTS_DIR"];
  resetConfig();
  rmSync(root, { recursive: true, force: true });
});

function seedBackupFixture() {
  const db = getDatabase();
  const project = createProject({ name: "Backup", path: "/tmp/backup" }, db);
  const taskList = createTaskList({ name: "Backup List", slug: "backup", project_id: project.id }, db);
  const plan = createPlan({ name: "Backup Plan", project_id: project.id, task_list_id: taskList.id }, db);
  const task = createTask({
    title: "Back up local work",
    project_id: project.id,
    task_list_id: taskList.id,
    plan_id: plan.id,
    tags: ["backup"],
    metadata: { fixture: true },
  }, db);
  addComment({ task_id: task.id, content: "ready to preserve", type: "progress" }, db);
  const run = startTaskRun({ task_id: task.id, title: "backup run", agent_id: "codex" }, db);
  addTaskRunCommand({ run_id: run.id, command: "bun test", status: "passed", output_summary: "ok" }, db);
  const artifactPath = join(root, "evidence.log");
  writeFileSync(artifactPath, "backup evidence\n");
  addTaskRunArtifact({ run_id: run.id, path: artifactPath, artifact_type: "log", store_content: true }, db);
  return { project, task, run };
}

describe("local backups", () => {
  test("creates a local-only manifest with checksums and verifies it", () => {
    const { project } = seedBackupFixture();
    const outputPath = join(root, "backup.json");
    const backup = createLocalBackup({
      project_id: project.id,
      generated_at: "2026-01-02T03:04:05.000Z",
      version: "1.2.3",
      output_path: outputPath,
    }, getDatabase());

    expect(backup).toMatchObject({
      schema_version: 1,
      kind: TODOS_LOCAL_BACKUP_KIND,
      local_only: true,
      no_network: true,
      package: { packageName: "@hasna/todos", repository: "hasna/todos", version: "1.2.3" },
    });
    expect(backup.manifest.bridge.stats).toMatchObject({
      projects: 1,
      task_lists: 1,
      plans: 1,
      tasks: 1,
      comments: 1,
      runs: 1,
      run_commands: 1,
      run_artifacts: 1,
    });
    expect(backup.manifest.bridge.artifact_contents).toBe(1);
    expect(readLocalBackupFile(outputPath).checksum).toBe(backup.checksum);

    const verification = verifyLocalBackup(backup, { verified_at: "2026-01-02T04:00:00.000Z" }, getDatabase());
    expect(verification.ok).toBe(true);
    expect(verification.checksum.ok).toBe(true);
    expect(verification.bridge_checksum.ok).toBe(true);
    expect(verification.counts.ok).toBe(true);
  });

  test("detects corrupted backup payloads before restore", () => {
    seedBackupFixture();
    const backup = createLocalBackup({ generated_at: "2026-01-02T03:04:05.000Z" }, getDatabase());
    const corrupted = structuredClone(backup);
    corrupted.bridge.data.tasks[0]!.title = "tampered";

    const verification = verifyLocalBackup(corrupted, { verified_at: "2026-01-02T04:00:00.000Z" }, getDatabase());

    expect(verification.ok).toBe(false);
    expect(verification.issues).toEqual(expect.arrayContaining([
      "bridge checksum mismatch",
      "backup checksum mismatch",
      "section checksum mismatch: tasks",
    ]));
  });

  test("dry-runs and applies restores without mutating during preview", () => {
    const { task, run } = seedBackupFixture();
    const backup = createLocalBackup({ generated_at: "2026-01-02T03:04:05.000Z" }, getDatabase());

    closeDatabase();
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    process.env["HASNA_TODOS_ARTIFACTS_DIR"] = join(root, "restore-artifacts");
    const targetDb = getDatabase();

    const preview = restoreLocalBackup(backup, { verified_at: "2026-01-02T04:00:00.000Z" }, targetDb);
    expect(preview.ok).toBe(true);
    expect(preview.dry_run).toBe(true);
    expect(preview.import_result?.inserted.tasks).toBe(1);
    expect(listTasks({}, targetDb)).toHaveLength(0);

    const applied = restoreLocalBackup(backup, { apply: true, verified_at: "2026-01-02T04:00:00.000Z" }, targetDb);
    expect(applied.ok).toBe(true);
    expect(applied.dry_run).toBe(false);
    expect(getTask(task.id, targetDb)?.title).toBe("Back up local work");
    expect(verifyTaskRunArtifacts(run.id, targetDb)[0]).toMatchObject({ status: "ok" });
  });

  test("reports SQLite, bridge, count, and orphan integrity locally", () => {
    seedBackupFixture();
    const report = checkLocalIntegrity({
      generated_at: "2026-01-02T03:04:05.000Z",
      version: "1.2.3",
    }, getDatabase());

    expect(report).toMatchObject({
      schema_version: 1,
      kind: "hasna.todos.local-integrity",
      local_only: true,
      no_network: true,
      sqlite: { quick_check: "ok", foreign_key_violations: 0, ok: true },
      ok: true,
    });
    expect(report.counts.tasks).toBe(1);
    expect(Object.values(report.orphaned_rows).every((count) => count === 0)).toBe(true);
  });

  test("writes backup files through the explicit writer", () => {
    seedBackupFixture();
    const backup = createLocalBackup({ generated_at: "2026-01-02T03:04:05.000Z" }, getDatabase());
    const path = writeLocalBackupFile(backup, join(root, "nested", "backup.json"));

    expect(readLocalBackupFile(path).manifest.bridge.stats.tasks).toBe(1);
  });
});
