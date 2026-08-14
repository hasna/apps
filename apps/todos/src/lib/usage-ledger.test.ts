import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { logTrace } from "../db/traces.js";
import { addTaskRunArtifact, addTaskRunCommand, addTaskRunEvent, finishTaskRun, startTaskRun } from "../db/task-runs.js";
import { createTask, logCost } from "../db/tasks.js";
import { createLocalUsageLedger, renderLocalUsageLedgerMarkdown } from "./usage-ledger.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("local usage ledger", () => {
  test("aggregates local tasks, projects, runs, commands, costs, durations, storage, and quotas", () => {
    const db = getDatabase();
    const project = createProject({ name: "Usage Project", path: "/tmp/usage-project" }, db);
    const task = createTask({ title: "Usage task", project_id: project.id, assigned_to: "codex" }, db);
    logCost(task.id, 100, 0.01, db);
    logTrace({ task_id: task.id, agent_id: "codex", trace_type: "llm_call", tokens: 200, cost_usd: 0.02, duration_ms: 500 }, db);

    const run = startTaskRun({
      task_id: task.id,
      agent_id: "codex",
      title: "Usage run",
      metadata: { usage: { total_tokens: 40, cost_usd: 0.004, duration_ms: 300 } },
      started_at: "2026-01-02T03:00:00.000Z",
    }, db);
    addTaskRunCommand({
      run_id: run.id,
      command: "bun test --flag=redacted",
      status: "passed",
      output_summary: "1 pass",
      tokens: 60,
      cost_usd: 0.006,
      duration_ms: 700,
      agent_id: "codex",
    }, db);
    addTaskRunEvent({
      run_id: run.id,
      event_type: "progress",
      data: { model: { input_tokens: 10, output_tokens: 15, cost_usd: 0.002 } },
      agent_id: "codex",
    }, db);
    addTaskRunArtifact({
      run_id: run.id,
      path: "logs/usage.txt",
      size_bytes: 1234,
      store_content: false,
      agent_id: "codex",
    }, db);
    finishTaskRun({
      run_id: run.id,
      status: "completed",
      completed_at: "2026-01-02T03:10:00.000Z",
      agent_id: "codex",
    }, db);

    const report = createLocalUsageLedger({
      project_id: project.id,
      agent_id: "codex",
      generated_at: "2026-01-02T03:15:00.000Z",
      quotas: { max_tasks: 1, max_tokens: 350, max_storage_bytes: 1000 },
    }, db);

    expect(report.local_only).toBe(true);
    expect(report.no_network).toBe(true);
    expect(report.counts).toMatchObject({
      tasks: 1,
      projects: 1,
      runs: 1,
      commands: 1,
      artifacts: 1,
      traces: 1,
    });
    expect(report.durations.completed_run_ms).toBe(600_000);
    expect(report.durations.trace_ms).toBe(500);
    expect(report.usage.total_tokens).toBe(425);
    expect(report.usage.total_cost_usd).toBe(0.042);
    expect(report.storage.evidence_bytes).toBe(1234);
    expect(report.quota.allowed).toBe(false);
    expect(report.quota.exceeded).toEqual(expect.arrayContaining(["max_tokens", "max_storage_bytes"]));
    expect(report.redaction.raw_commands_included).toBe(false);
    expect(JSON.stringify(report)).not.toContain("bun test --flag");
    expect(JSON.stringify(report)).not.toContain("logs/usage.txt");

    const markdown = renderLocalUsageLedgerMarkdown(report);
    expect(markdown).toContain("Local Usage Ledger");
    expect(markdown).toContain("Allowed: no");
  });

  test("uses open run duration for running ledgers", () => {
    const db = getDatabase();
    const task = createTask({ title: "Open run" }, db);
    startTaskRun({
      task_id: task.id,
      agent_id: "codex",
      started_at: "2026-01-02T03:00:00.000Z",
    }, db);

    const report = createLocalUsageLedger({
      agent_id: "codex",
      generated_at: "2026-01-02T03:05:00.000Z",
    }, db);

    expect(report.counts.runs).toBe(1);
    expect(report.durations.open_run_ms).toBe(300_000);
  });
});
