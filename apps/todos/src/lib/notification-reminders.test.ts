import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, startTask } from "../db/tasks.js";
import { registerAgent } from "../db/agents.js";
import {
  NOTIFICATION_REMINDERS_SCHEMA,
  createReminder,
  getReminder,
  listReminders,
  scanReminders,
  processDueReminders,
  dismissReminder,
  snoozeReminder,
  getReminderSummary,
  getReminderPreferences,
  setReminderPreferences,
  getUpcomingDueTasks,
  notifyUpcomingDeadlines,
} from "./notification-reminders.js";

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

describe("notification reminders", () => {
  it("creates custom reminders", () => {
    const reminder = createReminder(
      { title: "Standup", message: "Daily sync", trigger_at: hoursFromNow(1) },
      db,
    );
    expect(reminder.schema_version).toBe(NOTIFICATION_REMINDERS_SCHEMA);
    expect(reminder.reminder_type).toBe("custom");
    expect(reminder.status).toBe("pending");
    expect(listReminders({}, db)).toHaveLength(1);
  });

  it("scans due-soon and overdue tasks", () => {
    createTask({ title: "Soon", due_at: hoursFromNow(2), status: "pending" }, db);
    createTask({ title: "Late", due_at: hoursAgo(1), status: "in_progress" }, db);

    const result = scanReminders({}, db);
    expect(result.created).toBe(2);
    expect(result.reminders.some((r) => r.reminder_type === "due_soon")).toBe(true);
    expect(result.reminders.some((r) => r.reminder_type === "due_overdue")).toBe(true);
  });

  it("scans SLA warning and breach reminders", () => {
    const agent = registerAgent({ name: "sla-agent" }, db);
    const task = createTask({ title: "SLA task", assigned_to: agent.id }, db);
    db.run("UPDATE tasks SET sla_minutes = 60 WHERE id = ?", [task.id]);
    startTask(task.id, agent.id, db);

    db.run("UPDATE tasks SET started_at = ? WHERE id = ?", [hoursAgo(0.9), task.id]);

    const result = scanReminders({}, db);
    expect(result.reminders.some((r) => r.reminder_type === "sla_warning" || r.reminder_type === "sla_breach")).toBe(true);
  });

  it("processes due reminders without desktop notify by default", () => {
    const reminder = createReminder({ title: "Now", trigger_at: hoursAgo(0.1) }, db);
    const result = processDueReminders({}, db);
    expect(result.fired).toBe(1);
    expect(result.desktop_notifications_sent).toBe(0);
    expect(getReminder(reminder.id, db)?.status).toBe("fired");
  });

  it("dismisses and snoozes reminders", () => {
    const reminder = createReminder({ title: "Later", trigger_at: hoursFromNow(1) }, db);
    dismissReminder(reminder.id, db);
    expect(listReminders({ status: "dismissed" }, db)).toHaveLength(1);

    const again = createReminder({ title: "Snooze me", trigger_at: hoursFromNow(1) }, db);
    snoozeReminder(again.id, hoursFromNow(3), db);
    const snoozed = listReminders({ status: "snoozed" }, db)[0]!;
    expect(snoozed.snoozed_until).toBeTruthy();
  });

  it("dismisses reminders when task completes", () => {
    const task = createTask({ title: "Finish me", due_at: hoursFromNow(1) }, db);
    scanReminders({}, db);
    db.run("UPDATE tasks SET status = 'completed', completed_at = ? WHERE id = ?", [new Date().toISOString(), task.id]);
    const rescanned = scanReminders({}, db);
    expect(rescanned.dismissed).toBeGreaterThan(0);
  });

  it("manages reminder preferences", () => {
    const prefs = setReminderPreferences({ due_soon_hours: 48, desktop_notify: true }, db);
    expect(prefs.due_soon_hours).toBe(48);
    expect(prefs.desktop_notify).toBe(true);
    expect(getReminderPreferences(db).due_soon_hours).toBe(48);
  });

  it("returns reminder summary", () => {
    createReminder({ title: "A", trigger_at: hoursFromNow(1) }, db);
    createReminder({ title: "B", trigger_at: hoursAgo(0.1) }, db);
    const summary = getReminderSummary(db);
    expect(summary.pending).toBeGreaterThanOrEqual(1);
    expect(summary.due_now).toBeGreaterThanOrEqual(1);
    expect(summary.schema_version).toBe(NOTIFICATION_REMINDERS_SCHEMA);
  });

  it("getUpcomingDueTasks and notifyUpcomingDeadlines match", () => {
    createTask({ title: "Due tomorrow", due_at: hoursFromNow(12) }, db);
    createTask({ title: "Due next week", due_at: hoursFromNow(200) }, db);
    const upcoming = getUpcomingDueTasks({ hours: 24 }, db);
    expect(upcoming).toHaveLength(1);
    expect(notifyUpcomingDeadlines({ hours: 24 }, db)).toHaveLength(1);
  });
});
