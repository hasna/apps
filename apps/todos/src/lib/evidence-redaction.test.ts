import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addTaskVerification } from "../db/task-commits.js";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";
import { listSecretFindings } from "./redaction.js";
import {
  TODOS_EVIDENCE_REDACTION_CONFIRM,
  redactEvidenceRows,
} from "./evidence-redaction.js";

let root: string;
let dbPath: string;

setDefaultTimeout(20000);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "todos-evidence-redaction-"));
  dbPath = join(root, "todos.db");
  process.env["TODOS_DB_PATH"] = dbPath;
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(root, { recursive: true, force: true });
});

function fakeNpmToken(): string {
  return `npm_${"a".repeat(36)}`;
}

function fakeGithubToken(): string {
  return `github_pat_${"A".repeat(32)}`;
}

function assignment(keyParts: string[], value: string): string {
  return `${keyParts.join("")}=${value}`;
}

function seedHistoricalEvidenceRows() {
  const db = getDatabase();
  const task = createTask({ title: "Historical evidence cleanup" }, db);
  const commentId = "00000000-0000-4000-8000-000000000401";
  const npmValue = fakeNpmToken();
  const githubValue = fakeGithubToken();
  const npmAssignment = assignment(["NPM_", "TO", "KEN"], npmValue);
  const genericAssignment = assignment(["TO", "KEN"], npmValue);
  const timestamp = "2026-01-02T03:04:05.000Z";

  db.run("UPDATE tasks SET description = ?, reason = ? WHERE id = ?", [
    `Legacy description with ${npmAssignment}`,
    `Legacy reason with ${githubValue}`,
    task.id,
  ]);
  db.run(
    "INSERT INTO task_comments (id, task_id, content, created_at) VALUES (?, ?, ?, ?)",
    [commentId, task.id, `Comment mirror ${genericAssignment}`, timestamp],
  );
  db.run(
    "INSERT INTO task_history (id, task_id, action, field, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      "00000000-0000-4000-8000-000000000402",
      task.id,
      "update",
      "description",
      `old ${npmValue}`,
      `new ${githubValue}`,
      timestamp,
    ],
  );
  db.run(
    "INSERT INTO activity_log (id, entity_type, entity_id, action, old_value, new_value, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      "00000000-0000-4000-8000-000000000403",
      "task",
      task.id,
      "update",
      `old ${npmValue}`,
      `new ${githubValue}`,
      JSON.stringify({ token: npmValue }),
      timestamp,
    ],
  );
  addTaskVerification({
    task_id: task.id,
    command: "manual verification",
    status: "failed",
    output_summary: `verification output ${npmValue}`,
  }, db);
  db.run(
    "INSERT INTO verification_records (id, task_id, provider_name, provider_type, status, summary, evidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      "00000000-0000-4000-8000-000000000404",
      task.id,
      "manual",
      "manual",
      "failed",
      `portable summary ${githubValue}`,
      JSON.stringify({ log_excerpt: npmValue }),
      timestamp,
    ],
  );

  return { taskId: task.id, commentId };
}

function scopedEvidenceText(taskId: string, commentId: string): string {
  const db = getDatabase();
  const task = db.query("SELECT title, description, reason FROM tasks WHERE id = ?").get(taskId);
  const comment = db.query("SELECT content FROM task_comments WHERE id = ?").get(commentId);
  const history = db.query("SELECT old_value, new_value FROM task_history WHERE task_id = ?").all(taskId);
  const activity = db.query("SELECT old_value, new_value, metadata FROM activity_log WHERE entity_id = ?").all(taskId);
  const verification = db.query("SELECT command, output_summary FROM task_verifications WHERE task_id = ?").all(taskId);
  const portable = db.query("SELECT summary, evidence FROM verification_records WHERE task_id = ?").all(taskId);
  return JSON.stringify({ task, comment, history, activity, verification, portable });
}

describe("evidence redaction", () => {
  test("dry-runs scoped historical evidence without mutating rows or exposing values", () => {
    const { taskId, commentId } = seedHistoricalEvidenceRows();

    const report = redactEvidenceRows({ task_ids: [taskId], comment_ids: [commentId] }, getDatabase());

    expect(report.dry_run).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.totals.matched_fields).toBeGreaterThanOrEqual(6);
    expect(report.findings.some((finding) => finding.table === "task_comments" && finding.field === "content")).toBe(true);
    expect(report.findings.some((finding) => finding.surface === "activity")).toBe(true);
    expect(report.redacted_preview.clean).toBe(true);
    expect(JSON.stringify(report)).not.toContain(fakeNpmToken());
    expect(listSecretFindings(scopedEvidenceText(taskId, commentId)).length).toBeGreaterThan(0);
  });

  test("refuses apply without an explicit authority contract", () => {
    const { taskId, commentId } = seedHistoricalEvidenceRows();

    const report = redactEvidenceRows({ task_ids: [taskId], comment_ids: [commentId], apply: true });

    expect(report.issues).toEqual(expect.arrayContaining([
      "apply requires --authority with an explicit rotation/redaction approval reference",
      `apply requires --confirm ${TODOS_EVIDENCE_REDACTION_CONFIRM}`,
    ]));
    expect(report.backup).toBeNull();
    expect(listSecretFindings(scopedEvidenceText(taskId, commentId)).length).toBeGreaterThan(0);
  });

  test("backs up before applying and removes scoped live-store findings", () => {
    const { taskId, commentId } = seedHistoricalEvidenceRows();
    const backupPath = join(root, "pre-redaction.db");

    const report = redactEvidenceRows({
      task_ids: [taskId],
      comment_ids: [commentId],
      apply: true,
      authority: "test-authority-no-secret-values",
      confirm: TODOS_EVIDENCE_REDACTION_CONFIRM,
      backup_output: backupPath,
    });

    expect(report.issues).toEqual([]);
    expect(report.backup?.path).toBe(backupPath);
    expect(report.backup?.integrity_ok).toBe(true);
    expect(existsSync(backupPath)).toBe(true);
    expect(report.post_scan?.clean).toBe(true);
    expect(report.totals.applied_fields).toBeGreaterThanOrEqual(6);
    expect(listSecretFindings(scopedEvidenceText(taskId, commentId))).toEqual([]);
  });
});
