import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addComment } from "../db/comments.js";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { addTaskVerification } from "../db/task-commits.js";
import { createTask } from "../db/tasks.js";
import { addTaskRunArtifact, addTaskRunCommand, finishTaskRun, startTaskRun } from "../db/task-runs.js";
import { artifactStorePath } from "./artifact-store.js";
import {
  RETENTION_CLEANUP_CONFIRMATION,
  applyRetentionCleanup,
  previewRetentionCleanup,
} from "./retention-cleanup.js";

const OLD = "2026-01-01T00:00:00.000Z";
const RECENT = "2026-05-20T00:00:00.000Z";
const NOW = "2026-05-22T00:00:00.000Z";

let artifactsDir: string;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  artifactsDir = mkdtempSync(join(tmpdir(), "todos-retention-artifacts-"));
  process.env["HASNA_TODOS_ARTIFACTS_DIR"] = artifactsDir;
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  rmSync(artifactsDir, { recursive: true, force: true });
  delete process.env["TODOS_DB_PATH"];
  delete process.env["HASNA_TODOS_ARTIFACTS_DIR"];
});

function count(table: string): number {
  return (getDatabase().query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

describe("local retention cleanup", () => {
  test("previews old comments runs and verifications without mutation or raw evidence content", () => {
    const db = getDatabase();
    const token = ["sk", "abcdefghijklmnop"].join("-");
    const bearer = "secretsecretsecret";
    const project = createProject({ name: "Retention", path: "/tmp/retention" }, db);
    const task = createTask({ title: "Clean old evidence", project_id: project.id }, db);
    addComment({ task_id: task.id, content: `legacy ${token} evidence` }, db);
    db.run("UPDATE task_comments SET created_at = ? WHERE task_id = ?", [OLD, task.id]);
    const run = startTaskRun({ task_id: task.id, title: "legacy run" }, db);
    addTaskRunCommand({ run_id: run.id, command: `curl bearer ${bearer}`, status: "passed" }, db);
    finishTaskRun({ run_id: run.id, status: "completed" }, db);
    db.run("UPDATE task_runs SET started_at = ?, completed_at = ?, created_at = ?, updated_at = ? WHERE id = ?", [OLD, OLD, OLD, OLD, run.id]);
    db.run("UPDATE task_verifications SET run_at = ?, created_at = ? WHERE task_id = ?", [OLD, OLD, task.id]);

    const report = previewRetentionCleanup({ older_than_days: 30, now: NOW }, db);
    const serialized = JSON.stringify(report);

    expect(report.dry_run).toBe(true);
    expect(report.local_only).toBe(true);
    expect(report.candidate_counts).toMatchObject({ comments: 1, runs: 1, verifications: 1 });
    expect(count("task_comments")).toBe(1);
    expect(count("task_runs")).toBe(1);
    expect(count("task_verifications")).toBe(1);
    expect(serialized).not.toContain("legacy sk-");
    expect(serialized).not.toContain(bearer);
    expect(serialized).not.toContain("curl bearer");
  });

  test("requires exact confirmation before destructive cleanup", () => {
    const db = getDatabase();
    const project = createProject({ name: "Retention", path: "/tmp/retention" }, db);
    const task = createTask({ title: "Needs confirmation", project_id: project.id }, db);
    addComment({ task_id: task.id, content: "old" }, db);
    db.run("UPDATE task_comments SET created_at = ? WHERE task_id = ?", [OLD, task.id]);

    expect(() => applyRetentionCleanup({ older_than_days: 30, now: NOW }, db)).toThrow(RETENTION_CLEANUP_CONFIRMATION);
    expect(count("task_comments")).toBe(1);
  });

  test("applies project and status scoped cleanup while leaving unmatched local records", () => {
    const db = getDatabase();
    const firstProject = createProject({ name: "First", path: "/tmp/first" }, db);
    const secondProject = createProject({ name: "Second", path: "/tmp/second" }, db);
    const matched = createTask({ title: "Matched", project_id: firstProject.id }, db);
    const unmatchedProject = createTask({ title: "Wrong project", project_id: secondProject.id }, db);
    const unmatchedStatus = createTask({ title: "Wrong status", project_id: firstProject.id }, db);
    db.run("UPDATE tasks SET status = 'completed' WHERE id IN (?, ?)", [matched.id, unmatchedProject.id]);

    for (const task of [matched, unmatchedProject, unmatchedStatus]) {
      addComment({ task_id: task.id, content: `old ${task.title}` }, db);
      db.run("UPDATE task_comments SET created_at = ? WHERE task_id = ?", [OLD, task.id]);
      const run = startTaskRun({ task_id: task.id, title: `run ${task.title}` }, db);
      finishTaskRun({ run_id: run.id, status: "completed" }, db);
      db.run("UPDATE task_runs SET started_at = ?, completed_at = ?, created_at = ?, updated_at = ? WHERE id = ?", [OLD, OLD, OLD, OLD, run.id]);
      addTaskVerification({ task_id: task.id, command: "bun test", status: "passed", run_at: OLD }, db);
      db.run("UPDATE task_verifications SET created_at = ? WHERE task_id = ?", [OLD, task.id]);
    }

    const report = applyRetentionCleanup({
      older_than_days: 30,
      project_id: firstProject.id,
      task_statuses: ["completed"],
      run_statuses: ["completed"],
      include: ["comments", "runs", "verifications"],
      now: NOW,
      confirm: RETENTION_CLEANUP_CONFIRMATION,
    }, db);

    expect(report.deleted_counts).toMatchObject({ comments: 1, runs: 1, verifications: 1 });
    expect(count("task_comments")).toBe(2);
    expect(count("task_runs")).toBe(2);
    expect(count("task_verifications")).toBe(2);
  });

  test("deletes only expired local artifact files without exposing source paths", () => {
    const db = getDatabase();
    const project = createProject({ name: "Artifacts", path: "/tmp/artifacts" }, db);
    const task = createTask({ title: "Prune artifact", project_id: project.id }, db);
    const run = startTaskRun({ task_id: task.id, title: "artifact run" }, db);
    const sourcePath = join(artifactsDir, "source.log");
    writeFileSync(sourcePath, `stored token ${["sk", "abcdefghijklmnop"].join("-")}\n`);
    const artifact = addTaskRunArtifact({ run_id: run.id, path: sourcePath, store_content: true, retention_days: 0 }, db);
    const relativePath = (artifact.metadata.artifact_store as { relative_path: string }).relative_path;
    expect(existsSync(artifactStorePath(relativePath))).toBe(true);

    const report = applyRetentionCleanup({
      older_than_days: 30,
      include: ["expired_artifacts"],
      now: "2999-01-01T00:00:00.000Z",
      confirm: RETENTION_CLEANUP_CONFIRMATION,
    }, db);

    expect(report.deleted_counts.artifact_files).toBe(1);
    expect(existsSync(artifactStorePath(relativePath))).toBe(false);
    expect(JSON.stringify(report)).toContain(relativePath);
    expect(JSON.stringify(report)).not.toContain(sourcePath);
    expect(count("task_run_artifacts")).toBe(1);
  });

  test("deletes stored artifact files when their old run is pruned", () => {
    const db = getDatabase();
    const project = createProject({ name: "Run artifacts", path: "/tmp/run-artifacts" }, db);
    const task = createTask({ title: "Prune run artifact", project_id: project.id }, db);
    const run = startTaskRun({ task_id: task.id, title: "artifact run" }, db);
    const sourcePath = join(artifactsDir, "run-source.log");
    writeFileSync(sourcePath, "stored run output\n");
    const artifact = addTaskRunArtifact({ run_id: run.id, path: sourcePath, store_content: true }, db);
    finishTaskRun({ run_id: run.id, status: "completed" }, db);
    db.run("UPDATE task_runs SET started_at = ?, completed_at = ?, created_at = ?, updated_at = ? WHERE id = ?", [OLD, OLD, OLD, OLD, run.id]);
    const relativePath = (artifact.metadata.artifact_store as { relative_path: string }).relative_path;
    expect(existsSync(artifactStorePath(relativePath))).toBe(true);

    const report = applyRetentionCleanup({
      older_than_days: 30,
      include: ["runs", "expired_artifacts"],
      now: NOW,
      confirm: RETENTION_CLEANUP_CONFIRMATION,
    }, db);

    expect(report.deleted_counts.runs).toBe(1);
    expect(report.deleted_counts.artifact_files).toBe(1);
    expect(existsSync(artifactStorePath(relativePath))).toBe(false);
    expect(count("task_runs")).toBe(0);
    expect(count("task_run_artifacts")).toBe(0);
  });

  test("leaves recent local records outside the retention window", () => {
    const db = getDatabase();
    const project = createProject({ name: "Recent", path: "/tmp/recent" }, db);
    const task = createTask({ title: "Recent evidence", project_id: project.id }, db);
    addComment({ task_id: task.id, content: "recent" }, db);
    db.run("UPDATE task_comments SET created_at = ? WHERE task_id = ?", [RECENT, task.id]);

    const report = applyRetentionCleanup({
      older_than_days: 30,
      now: NOW,
      confirm: RETENTION_CLEANUP_CONFIRMATION,
    }, db);

    expect(report.candidate_counts.comments).toBe(0);
    expect(report.deleted_counts.comments).toBe(0);
    expect(count("task_comments")).toBe(1);
  });
});
