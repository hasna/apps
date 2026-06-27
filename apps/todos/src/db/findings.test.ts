import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import {
  beginTaskRunTransaction,
  finishTaskRunTransaction,
  getTaskRunLedger,
} from "./task-runs.js";
import { createTask } from "./tasks.js";
import {
  listCompactTaskFindings,
  resolveMissingTaskFindings,
  upsertTaskFinding,
} from "./findings.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("loop run transactions and task findings", () => {
  test("begins and finishes a run idempotently by transaction key", () => {
    const db = getDatabase();
    const task = createTask({ title: "Loop transaction task" }, db);

    const preview = beginTaskRunTransaction({
      task_id: task.id,
      key: "loop-run-1",
      title: "Loop run",
    }, db);
    expect(preview.dry_run).toBe(true);
    expect(preview.action).toBe("preview");
    expect(preview.run).toBeNull();

    const created = beginTaskRunTransaction({
      task_id: task.id,
      key: "loop-run-1",
      loop_id: "nightly",
      agent_id: "agent-1",
      title: "Loop run",
      apply: true,
    }, db);
    expect(created.dry_run).toBe(false);
    expect(created.action).toBe("created");
    expect(created.run?.idempotency_key).toBe("loop-run-1");

    const matched = beginTaskRunTransaction({
      task_id: task.id,
      key: "loop-run-1",
      title: "Changed title should not duplicate",
      apply: true,
    }, db);
    expect(matched.action).toBe("matched");
    expect(matched.run?.id).toBe(created.run?.id);
    const transactionRows = db
      .query("SELECT * FROM task_run_transactions WHERE task_id = ? AND key = ?")
      .all(task.id, "loop-run-1");
    expect(transactionRows).toHaveLength(1);

    const finished = finishTaskRunTransaction({
      key: "loop-run-1",
      task_id: task.id,
      status: "completed",
      summary: "done",
      apply: true,
    }, db);
    expect(finished.action).toBe("finished");
    expect(finished.run?.status).toBe("completed");

    const secondFinish = finishTaskRunTransaction({
      key: "loop-run-1",
      task_id: task.id,
      status: "completed",
      summary: "done",
      apply: true,
    }, db);
    expect(secondFinish.action).toBe("matched");
    expect(getTaskRunLedger(created.run!.id, db).events.filter((event) => event.event_type === "completed")).toHaveLength(1);
  });

  test("upserts findings idempotently and resolves missing findings by source", () => {
    const db = getDatabase();
    const task = createTask({ title: "Finding task" }, db);
    const run = beginTaskRunTransaction({
      task_id: task.id,
      key: "finding-run",
      title: "Finding run",
      apply: true,
    }, db).run!;

    const preview = upsertTaskFinding({
      task_id: task.id,
      run_id: run.id,
      fingerprint: "Console Error",
      title: "Console error with api_key=secretvalue123456789",
      severity: "high",
      source: "browser-loop",
      summary: "Stack includes api_key=secretvalue123456789",
    }, db);
    expect(preview.dry_run).toBe(true);
    expect(preview.action).toBe("preview");

    const created = upsertTaskFinding({
      task_id: task.id,
      run_id: run.id,
      fingerprint: "Console Error",
      title: "Console error with api_key=secretvalue123456789",
      severity: "high",
      source: "browser-loop",
      summary: "Stack includes api_key=secretvalue123456789",
      artifact_path: "artifacts/browser.log",
      metadata: { raw: "secretvalue123456789" },
      apply: true,
    }, db);
    expect(created.action).toBe("created");
    expect(created.finding?.fingerprint).toBe("console-error");
    expect(created.finding?.title).toContain("[REDACTED]");
    expect(created.finding?.summary).toContain("[REDACTED]");
    expect(created.finding?.metadata_keys).toContain("raw");

    const matched = upsertTaskFinding({
      task_id: task.id,
      run_id: run.id,
      fingerprint: "console-error",
      title: "Console error with api_key=secretvalue123456789",
      severity: "high",
      source: "browser-loop",
      summary: "Stack includes api_key=secretvalue123456789",
      artifact_path: "artifacts/browser.log",
      metadata: { raw: "secretvalue123456789" },
      apply: true,
    }, db);
    expect(matched.action).toBe("matched");
    expect(listCompactTaskFindings({ task_id: task.id }, db)).toHaveLength(1);

    const other = upsertTaskFinding({
      task_id: task.id,
      fingerprint: "lint-warning",
      title: "Lint warning",
      severity: "low",
      source: "lint-loop",
      apply: true,
    }, db);
    expect(other.action).toBe("created");

    const resolvePreview = resolveMissingTaskFindings({
      task_id: task.id,
      fingerprints: [],
      source: "browser-loop",
    }, db);
    expect(resolvePreview.dry_run).toBe(true);
    expect(resolvePreview.candidate_count).toBe(1);
    expect(listCompactTaskFindings({ task_id: task.id, status: "open" }, db)).toHaveLength(2);

    const resolved = resolveMissingTaskFindings({
      task_id: task.id,
      fingerprints: [],
      source: "browser-loop",
      run_id: run.id,
      apply: true,
    }, db);
    expect(resolved.action).toBe("resolved");
    expect(resolved.changed_count).toBe(1);
    expect(listCompactTaskFindings({ task_id: task.id, status: "open" }, db).map((finding) => finding.fingerprint)).toEqual(["lint-warning"]);

    const reopened = upsertTaskFinding({
      task_id: task.id,
      run_id: run.id,
      fingerprint: "console-error",
      title: "Console error with api_key=secretvalue123456789",
      severity: "high",
      source: "browser-loop",
      summary: "Stack includes api_key=secretvalue123456789",
      artifact_path: "artifacts/browser.log",
      metadata: { raw: "secretvalue123456789" },
      apply: true,
    }, db);
    expect(reopened.action).toBe("reopened");
    expect(reopened.finding?.status).toBe("open");
  });

  test("finding dry-runs preview updates and reopens without mutating", () => {
    const db = getDatabase();
    const task = createTask({ title: "Finding dry-run task" }, db);
    const created = upsertTaskFinding({
      task_id: task.id,
      fingerprint: "dry-run-finding",
      title: "Old finding",
      status: "open",
      apply: true,
    }, db);
    expect(created.action).toBe("created");

    const updatePreview = upsertTaskFinding({
      task_id: task.id,
      fingerprint: "dry-run-finding",
      title: "New finding",
      status: "open",
    }, db);
    expect(updatePreview.action).toBe("updated");
    expect(updatePreview.finding?.title).toBe("New finding");
    expect(listCompactTaskFindings({ task_id: task.id }, db)[0]?.title).toBe("Old finding");

    resolveMissingTaskFindings({
      task_id: task.id,
      fingerprints: [],
      apply: true,
    }, db);
    const reopenPreview = upsertTaskFinding({
      task_id: task.id,
      fingerprint: "dry-run-finding",
      title: "New finding",
      status: "open",
    }, db);
    expect(reopenPreview.action).toBe("reopened");
    expect(reopenPreview.finding?.status).toBe("open");
    expect(listCompactTaskFindings({ task_id: task.id }, db)[0]?.status).toBe("resolved");
  });

  test("resolve-missing mutates every candidate while bounding output", () => {
    const db = getDatabase();
    const task = createTask({ title: "Many findings task" }, db);
    for (let index = 0; index < 12; index += 1) {
      upsertTaskFinding({
        task_id: task.id,
        fingerprint: `missing-${index}`,
        title: `Missing ${index}`,
        source: "bulk-loop",
        apply: true,
      }, db);
    }

    const resolved = resolveMissingTaskFindings({
      task_id: task.id,
      fingerprints: [],
      source: "bulk-loop",
      limit: 5,
      apply: true,
    }, db);
    expect(resolved.candidate_count).toBe(12);
    expect(resolved.changed_count).toBe(12);
    expect(resolved.findings).toHaveLength(5);
    expect(resolved.omitted_count).toBe(7);
    expect(listCompactTaskFindings({ task_id: task.id, status: "open", limit: 20 }, db)).toHaveLength(0);
  });
});
