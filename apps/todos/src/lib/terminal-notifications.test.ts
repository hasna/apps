import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, startTask, completeTask } from "../db/tasks.js";
import { registerAgent } from "../db/agents.js";
import { logTaskChange } from "../db/audit.js";
import {
  TERMINAL_NOTIFICATIONS_SCHEMA,
  WATCH_EVENT_TYPES,
  ensureDefaultWatchRules,
  createWatchRule,
  listWatchRules,
  deleteWatchRule,
  ruleMatchesEvent,
  collectWatchEvents,
  formatTerminalNotification,
  pollWatchNotifications,
  getWatchStatus,
  getWatchPreferences,
  setWatchPreferences,
  syncConfigWatchRules,
  type WatchEvent,
} from "./terminal-notifications.js";

let db: Database;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3600000).toISOString();
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600000).toISOString();
}

describe("terminal notifications", () => {
  it("seeds default watch rules on first use", () => {
    const rules = ensureDefaultWatchRules(db);
    expect(rules.length).toBe(3);
    expect(listWatchRules({}, db)).toHaveLength(3);
  });

  it("creates and lists custom watch rules", () => {
    const rule = createWatchRule(
      { name: "My completions", events: ["task.completed"], bell: true },
      db,
    );
    expect(rule.schema_version).toBe(TERMINAL_NOTIFICATIONS_SCHEMA);
    expect(rule.events).toEqual(["task.completed"]);
    expect(listWatchRules({}, db).some((r) => r.id === rule.id)).toBe(true);
    expect(deleteWatchRule(rule.id, db)).toBe(true);
  });

  it("maps activity log entries to watch events deterministically", () => {
    const task = createTask({ title: "Ship feature" }, db);
    logTaskChange(task.id, "start", "status", "pending", "in_progress", "agent-1", db);
    logTaskChange(task.id, "complete", "status", "in_progress", "completed", "agent-1", db);

    const events = collectWatchEvents("1970-01-01T00:00:00.000Z", {}, db);
    expect(events.some((e) => e.event === "task.started" && e.entity_id === task.id)).toBe(true);
    expect(events.some((e) => e.event === "task.completed" && e.entity_id === task.id)).toBe(true);
  });

  it("collects due and stale synthetic events", () => {
    createTask({ title: "Due soon", due_at: hoursFromNow(2), status: "pending" }, db);
    const agent = registerAgent({ name: "stale-agent" }, db);
    const stale = createTask({ title: "Stale work", assigned_to: agent.id }, db);
    startTask(stale.id, agent.id, db);
    db.run("UPDATE tasks SET updated_at = ? WHERE id = ?", [hoursAgo(2), stale.id]);

    const events = collectWatchEvents("1970-01-01T00:00:00.000Z", {}, db);
    expect(events.some((e) => e.event === "task.due_soon")).toBe(true);
    expect(events.some((e) => e.event === "task.stale" && e.entity_id === stale.id)).toBe(true);
  });

  it("matches rules by event type and project path pattern", () => {
    const rule = createWatchRule(
      {
        name: "OSS only",
        events: ["task.completed"],
        project_path_pattern: "/home/oss",
      },
      db,
    );

    const event: WatchEvent = {
      schema_version: TERMINAL_NOTIFICATIONS_SCHEMA,
      id: "evt-1",
      event: "task.completed",
      entity_type: "task",
      entity_id: "abc12345-0000-0000-0000-000000000001",
      title: "Done",
      message: null,
      project_id: null,
      agent_id: null,
      severity: "info",
      occurred_at: new Date().toISOString(),
      metadata: {},
    };

    expect(ruleMatchesEvent(rule, event, { project_path: "/home/oss/open-todos" })).toBe(true);
    expect(ruleMatchesEvent(rule, event, { project_path: "/tmp/other" })).toBe(false);
  });

  it("polls and emits terminal notifications with dedup", () => {
    ensureDefaultWatchRules(db);
    const agent = registerAgent({ name: "worker" }, db);
    const task = createTask({ title: "Notify me" }, db);
    startTask(task.id, agent.id, db);
    completeTask(task.id, agent.id, db);

    const lines: string[] = [];
    const bells: string[] = [];
    const result = pollWatchNotifications(
      {
        since: "1970-01-01T00:00:00.000Z",
        emit: (line) => lines.push(line),
        onBell: () => bells.push("bell"),
      },
      db,
    );

    expect(result.notifications_sent).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("task.completed"))).toBe(true);
    expect(bells.length).toBeGreaterThan(0);

    const again = pollWatchNotifications(
      { since: result.polled_at, emit: (line) => lines.push(line) },
      db,
    );
    expect(again.notifications_sent).toBe(0);
  });

  it("respects quiet mode without terminal output", () => {
    setWatchPreferences({ quiet: true, bell: false }, db);
    ensureDefaultWatchRules(db);
    const agent = registerAgent({ name: "quiet-worker" }, db);
    const task = createTask({ title: "Quiet task" }, db);
    startTask(task.id, agent.id, db);

    const lines: string[] = [];
    pollWatchNotifications(
      {
        since: "1970-01-01T00:00:00.000Z",
        emit: (line) => lines.push(line),
        onBell: () => lines.push("bell"),
      },
      db,
    );
    expect(lines.length).toBe(0);
  });

  it("formats terminal notification lines", () => {
    const line = formatTerminalNotification({
      schema_version: TERMINAL_NOTIFICATIONS_SCHEMA,
      id: "x",
      event: "task.failed",
      entity_type: "task",
      entity_id: "12345678-abcd",
      title: "Broken build",
      message: "Tests failed",
      project_id: null,
      agent_id: null,
      severity: "error",
      occurred_at: "2026-01-01T00:00:00.000Z",
      metadata: {},
    });
    expect(line).toContain("[ERROR]");
    expect(line).toContain("task.failed");
    expect(line).toContain("Broken build");
    expect(line).toContain("Tests failed");
  });

  it("reports watch status summary", () => {
    ensureDefaultWatchRules(db);
    const status = getWatchStatus(db);
    expect(status.schema_version).toBe(TERMINAL_NOTIFICATIONS_SCHEMA);
    expect(status.rules_total).toBeGreaterThan(0);
    expect(status.preferences.poll_interval_seconds).toBeGreaterThan(0);
  });

  it("exports canonical watch event types", () => {
    expect(WATCH_EVENT_TYPES).toContain("approval.pending");
    expect(WATCH_EVENT_TYPES).toContain("run.failed");
    expect(WATCH_EVENT_TYPES).toContain("check.failed");
  });

  it("syncs config watch rules without error when config is empty", () => {
    const synced = syncConfigWatchRules(process.cwd(), db);
    expect(Array.isArray(synced)).toBe(true);
  });
});
