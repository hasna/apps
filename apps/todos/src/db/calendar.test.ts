import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createCalendarItem, exportCalendarIcs, importCalendarIcs, listCalendarEvents } from "./calendar.js";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import { createTask, startTask } from "./tasks.js";
import { startTaskRun, finishTaskRun } from "./task-runs.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("local calendar and ICS export", () => {
  it("derives due date SLA local item and run events", () => {
    const db = getDatabase();
    const task = createTask({
      title: "Calendar task",
      due_at: "2026-06-01T09:00:00.000Z",
      sla_minutes: 60,
      recurrence_rule: "every week",
    }, db);
    startTask(task.id, "calendar-agent", db);
    createCalendarItem({
      title: "Calendar milestone",
      kind: "milestone",
      starts_at: "2026-06-02T10:00:00.000Z",
      task_id: task.id,
    }, db);
    const run = startTaskRun({ task_id: task.id, title: "Calendar run", started_at: "2026-06-03T10:00:00.000Z" }, db);
    finishTaskRun({ run_id: run.id, status: "completed", completed_at: "2026-06-03T10:20:00.000Z" }, db);

    const events = listCalendarEvents({ include_completed: true }, db);
    expect(events.map((event) => event.kind)).toEqual(expect.arrayContaining(["task_due", "task_sla", "milestone", "run"]));
    expect(events.find((event) => event.kind === "task_due")!.recurrence_rule).toBe("every week");
    expect(events.find((event) => event.kind === "task_sla")!.badges).toContain("sla");
  });

  it("exports deterministic ICS and can redact event content", () => {
    const db = getDatabase();
    createTask({
      title: "Secret launch",
      description: "Contains confidential details",
      due_at: "2026-06-01T09:00:00.000Z",
      recurrence_rule: "every weekday",
    }, db);

    const exported = exportCalendarIcs({ calendar_name: "Local Todos", generated_at: "2026-01-01T00:00:00.000Z" }, db);
    expect(exported.content).toContain("BEGIN:VCALENDAR");
    expect(exported.content).toContain("SUMMARY:Due: Secret launch");
    expect(exported.content).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");

    const redacted = exportCalendarIcs({ redact: true, generated_at: "2026-01-01T00:00:00.000Z" }, db);
    expect(redacted.content).not.toContain("Secret launch");
    expect(redacted.content).not.toContain("confidential");
  });

  it("imports VEVENT entries as local calendar items", () => {
    const db = getDatabase();
    const result = importCalendarIcs(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:demo@example.com
DTSTART:20260601T090000Z
DTEND:20260601T093000Z
SUMMARY:Imported event
DESCRIPTION:Imported description
END:VEVENT
END:VCALENDAR`, db);

    expect(result.imported).toBe(1);
    expect(result.items[0]!.kind).toBe("imported");
    expect(result.items[0]!.starts_at).toBe("2026-06-01T09:00:00.000Z");
    expect(listCalendarEvents({ kind: "imported" }, db)[0]!.title).toBe("Imported event");
  });
});
