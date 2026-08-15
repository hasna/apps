import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createCalendarItem, createTask, startTask } from "../db/tasks.js";
import { finishTaskRun, startTaskRun } from "../db/task-runs.js";
import { resetConfig } from "./config.js";
import { upsertLocalEventHook } from "./event-hooks.js";
import { checkLocalNotifications } from "./local-notifications.js";
import { testTerminalNotificationRule, upsertTerminalNotificationRule } from "./terminal-notifications.js";

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env["HOME"];
  home = mkdtempSync(join(tmpdir(), "todos-local-notifications-"));
  process.env["HOME"] = home;
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetConfig();
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  resetConfig();
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  delete process.env["TODOS_DB_PATH"];
  rmSync(home, { recursive: true, force: true });
});

describe("local notification alerts", () => {
  test("checks due, SLA, stale, run, and local reminder alerts without hosted services", async () => {
    const db = getDatabase();
    const due = createTask({
      title: "Overdue deploy",
      due_at: "2026-01-02T03:00:00.000Z",
      priority: "critical",
      assigned_to: "codex",
    }, db);
    createTask({
      title: "Upcoming review",
      due_at: "2026-01-02T04:20:00.000Z",
      priority: "high",
      assigned_to: "codex",
    }, db);
    const sla = createTask({ title: "SLA task", sla_minutes: 30, assigned_to: "codex" }, db);
    db.run("UPDATE tasks SET status = 'in_progress', started_at = ?, created_at = ?, updated_at = ? WHERE id = ?", [
      "2026-01-02T02:00:00.000Z",
      "2026-01-02T02:00:00.000Z",
      "2026-01-02T02:00:00.000Z",
      sla.id,
    ]);
    const stale = createTask({ title: "Stale worker", assigned_to: "codex" }, db);
    startTask(stale.id, "codex", db);
    const old = new Date(Date.now() - 61 * 60_000).toISOString();
    db.run("UPDATE tasks SET updated_at = ?, locked_at = ? WHERE id = ?", [old, old, stale.id]);
    createCalendarItem({
      title: "Local reminder",
      kind: "task_reminder",
      starts_at: "2026-01-02T04:15:00.000Z",
      task_id: due.id,
    }, db);
    const run = startTaskRun({ task_id: due.id, agent_id: "codex", title: "Deploy run", started_at: "2026-01-02T03:30:00.000Z" }, db);
    finishTaskRun({ run_id: run.id, status: "completed", completed_at: "2026-01-02T03:55:00.000Z", agent_id: "codex" }, db);

    const filePath = join(home, "alerts.jsonl");
    upsertLocalEventHook({ name: "due-file", events: ["task.due"], target: "file", file_path: filePath });
    upsertTerminalNotificationRule({ name: "due-terminal", events: ["task.due"], min_severity: "warning", agent_ids: ["codex"] });

    const result = await checkLocalNotifications({
      now: "2026-01-02T04:00:00.000Z",
      due_within_minutes: 30,
      stale_minutes: 30,
      run_since: "2026-01-02T03:00:00.000Z",
      emit_hooks: true,
      evaluate_terminal: true,
    }, db);

    expect(result.local_only).toBe(true);
    expect(result.alerts.map((alert) => alert.kind)).toEqual(expect.arrayContaining([
      "task_due",
      "task_due_soon",
      "task_sla",
      "task_stale",
      "run_completed",
      "calendar_reminder",
    ]));
    expect(result.counts.task_due).toBe(1);
    expect(result.hook_results.some((hook) => hook.status === "delivered")).toBe(true);
    expect(result.terminal_evaluations.some((evaluation) => evaluation.matched)).toBe(true);
    expect(existsSync(filePath)).toBe(true);
    const event = JSON.parse(readFileSync(filePath, "utf-8").trim());
    expect(event.type).toBe("task.due");
    expect(event.payload.title).toBe("Overdue deploy");
  });

  test("suppresses delivery during quiet hours while still reporting alerts", async () => {
    const db = getDatabase();
    createTask({ title: "Quiet overdue", due_at: "2026-01-02T22:30:00.000Z" }, db);
    const filePath = join(home, "quiet.jsonl");
    upsertLocalEventHook({ name: "quiet-file", events: ["task.due"], target: "file", file_path: filePath });

    const result = await checkLocalNotifications({
      now: "2026-01-02T23:00:00.000Z",
      emit_hooks: true,
      evaluate_terminal: true,
      quiet_hours: { start: "22:00", end: "07:00", timezone: "utc" },
    }, db);

    expect(result.quiet_active).toBe(true);
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]!.quieted).toBe(true);
    expect(result.hook_results).toEqual([]);
    expect(existsSync(filePath)).toBe(false);
  });

  test("terminal notification rules can suppress matches with quiet hours", () => {
    upsertTerminalNotificationRule({
      name: "quiet-terminal",
      events: ["task.due"],
      min_severity: "warning",
      quiet_hours: { start: "22:00", end: "07:00", timezone: "utc" },
    });

    const result = testTerminalNotificationRule("quiet-terminal", {
      type: "task.due",
      timestamp: "2026-01-02T23:00:00.000Z",
      payload: { id: "task-1", title: "Night alert" },
    });

    expect(result.matched).toBe(false);
    expect(result.skipped_reasons).toContain("quiet hours active");
  });
});
