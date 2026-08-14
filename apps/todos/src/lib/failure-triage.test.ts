import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";
import { failTask } from "../db/task-lifecycle.js";
import { createRunRecord, failRunRecord } from "./run-records.js";
import {
  FAILURE_TRIAGE_SCHEMA,
  buildFailureTriageReport,
  applyFailureTriage,
  formatFailureTriageMarkdown,
} from "./failure-triage.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("failure triage", () => {
  it("reports failed tasks with classification and playbook", () => {
    const task = createTask({ title: "Broken build" });
    failTask(task.id, "agent", "command failed with exit code 1");

    const report = buildFailureTriageReport();
    expect(report.schema_version).toBe(FAILURE_TRIAGE_SCHEMA);
    expect(report.items.some((i) => i.entity_id === task.id)).toBe(true);
    expect(report.items[0]!.classification).toBe("command_failure");
    expect(report.items[0]!.playbook.length).toBeGreaterThan(0);
  });

  it("creates retry task when under retry limit", () => {
    const task = createTask({ title: "Flaky test", max_retries: 3 });
    failTask(task.id, "agent", "verification failed");

    const result = applyFailureTriage({
      task_id: task.id,
      action: "retry",
      root_cause: "test flake",
    });

    expect(result.retry_task).toBeTruthy();
    expect(result.retry_task!.status).toBe("pending");
    expect(result.escalated).toBe(false);
  });

  it("reopens failed task", () => {
    const task = createTask({ title: "Retry manually" });
    failTask(task.id, "agent", "blocked by dependency");

    const result = applyFailureTriage({ task_id: task.id, action: "reopen" });
    expect(result.task!.status).toBe("pending");
  });

  it("escalates when retries exhausted", () => {
    const task = createTask({ title: "No more retries", max_retries: 3 });
    failTask(task.id, "agent", "resource error disk full");
    getDatabase().run("UPDATE tasks SET retry_count = 3 WHERE id = ?", [task.id]);

    const result = applyFailureTriage({ task_id: task.id, action: "retry", max_retries: 3 });
    expect(result.retry_task).toBeUndefined();
    expect(result.escalated).toBe(true);
  });

  it("includes failed run records in report", () => {
    const run = createRunRecord({ objective: "Deploy" });
    failRunRecord(run.id, "command failed");

    const report = buildFailureTriageReport();
    expect(report.items.some((i) => i.entity_type === "run")).toBe(true);

    const md = formatFailureTriageMarkdown(report);
    expect(md).toContain("# Failure triage report");
  });
});
