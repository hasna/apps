import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createEvent, getEvent, listEvents, updateEvent, deleteEvent, findConflicts, findAgentConflicts, searchEvents } from "./events.js";
import { createCalendar } from "./calendars.js";
import { createOrg } from "./orgs.js";
import { createAttendee } from "./attendees.js";
import { registerAgent } from "./agents.js";
import { getDatabase, resetDatabase } from "./database.js";
import { NotFoundError } from "../types/index.js";

describe("events", () => {
  let orgId: string;
  let calendarId: string;

  beforeEach(() => {
    resetDatabase();
    getDatabase(":memory:");
    const org = createOrg({ name: "Test", slug: "test" });
    orgId = org.id;
    const cal = createCalendar({ name: "Main", org_id: orgId });
    calendarId = cal.id;
  });

  afterEach(() => resetDatabase());

  test("create and get event", () => {
    const evt = createEvent({
      title: "Sprint Planning",
      calendar_id: calendarId,
      org_id: orgId,
      start_at: "2026-04-15T09:00:00Z",
      end_at: "2026-04-15T10:00:00Z",
    });
    expect(evt.title).toBe("Sprint Planning");
    expect(evt.status).toBe("confirmed");

    const fetched = getEvent(evt.id);
    expect(fetched!.title).toBe("Sprint Planning");
  });

  test("default values", () => {
    const evt = createEvent({
      title: "Test",
      calendar_id: calendarId,
      org_id: orgId,
      start_at: "2026-04-15T09:00:00Z",
      end_at: "2026-04-15T10:00:00Z",
    });
    expect(evt.busy_type).toBe("busy");
    expect(evt.visibility).toBe("default");
    expect(evt.all_day).toBe(false);
    expect(evt.timezone).toBe("UTC");
  });

  test("list events filtered by calendar", () => {
    createEvent({ title: "A", calendar_id: calendarId, org_id: orgId, start_at: "2026-04-15T09:00:00Z", end_at: "2026-04-15T10:00:00Z" });
    createEvent({ title: "B", calendar_id: calendarId, org_id: orgId, start_at: "2026-04-15T11:00:00Z", end_at: "2026-04-15T12:00:00Z" });
    const events = listEvents({ calendar_id: calendarId });
    expect(events.length).toBe(2);
  });

  test("list events filtered by date range", () => {
    createEvent({ title: "Morning", calendar_id: calendarId, org_id: orgId, start_at: "2026-04-15T09:00:00Z", end_at: "2026-04-15T10:00:00Z" });
    createEvent({ title: "Afternoon", calendar_id: calendarId, org_id: orgId, start_at: "2026-04-15T14:00:00Z", end_at: "2026-04-15T15:00:00Z" });
    const morning = listEvents({ calendar_id: calendarId, after: "2026-04-15T08:00:00Z", before: "2026-04-15T12:00:00Z" });
    expect(morning.length).toBe(1);
    expect(morning[0]!.title).toBe("Morning");
  });

  test("update event", () => {
    const evt = createEvent({
      title: "Old",
      calendar_id: calendarId,
      org_id: orgId,
      start_at: "2026-04-15T09:00:00Z",
      end_at: "2026-04-15T10:00:00Z",
    });
    const updated = updateEvent(evt.id, { title: "New", location: "Room 42" });
    expect(updated.title).toBe("New");
    expect(updated.location).toBe("Room 42");
  });

  test("delete event", () => {
    const evt = createEvent({
      title: "Delete Me",
      calendar_id: calendarId,
      org_id: orgId,
      start_at: "2026-04-15T09:00:00Z",
      end_at: "2026-04-15T10:00:00Z",
    });
    expect(deleteEvent(evt.id)).toBe(true);
    expect(getEvent(evt.id)).toBeNull();
  });

  test("update nonexistent throws", () => {
    expect(() => updateEvent("nope", { title: "x" })).toThrow(NotFoundError);
  });

  test("recurrence rule stored", () => {
    const evt = createEvent({
      title: "Weekly Standup",
      calendar_id: calendarId,
      org_id: orgId,
      start_at: "2026-04-15T09:00:00Z",
      end_at: "2026-04-15T09:30:00Z",
      recurrence_rule: "FREQ=WEEKLY;BYDAY=MO",
    });
    expect(evt.recurrence_rule).toBe("FREQ=WEEKLY;BYDAY=MO");
  });

  test("source_task_id links to todos", () => {
    const evt = createEvent({
      title: "Deadline",
      calendar_id: calendarId,
      org_id: orgId,
      start_at: "2026-04-15T09:00:00Z",
      end_at: "2026-04-15T10:00:00Z",
      source_task_id: "task-123",
    });
    expect(evt.source_task_id).toBe("task-123");
  });

  test("find conflicts — overlapping events", () => {
    createEvent({
      title: "Meeting A",
      calendar_id: calendarId,
      org_id: orgId,
      start_at: "2026-04-15T09:00:00Z",
      end_at: "2026-04-15T10:00:00Z",
    });
    const conflicts = findConflicts(calendarId, { start: "2026-04-15T09:30:00Z", end: "2026-04-15T10:30:00Z" });
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.title).toBe("Meeting A");
  });

  test("find conflicts — no overlap", () => {
    createEvent({
      title: "Morning",
      calendar_id: calendarId,
      org_id: orgId,
      start_at: "2026-04-15T09:00:00Z",
      end_at: "2026-04-15T10:00:00Z",
    });
    const conflicts = findConflicts(calendarId, { start: "2026-04-15T11:00:00Z", end: "2026-04-15T12:00:00Z" });
    expect(conflicts.length).toBe(0);
  });

  test("find conflicts — excludes cancelled events", () => {
    createEvent({
      title: "Cancelled",
      calendar_id: calendarId,
      org_id: orgId,
      start_at: "2026-04-15T09:00:00Z",
      end_at: "2026-04-15T10:00:00Z",
      status: "cancelled",
    });
    const conflicts = findConflicts(calendarId, { start: "2026-04-15T09:30:00Z", end: "2026-04-15T10:30:00Z" });
    expect(conflicts.length).toBe(0);
  });

  test("find agent conflicts across calendars", () => {
    const agentId = registerAgent({ name: "agent1" }).id;
    const cal2 = createCalendar({ name: "Second", org_id: orgId });
    const evt1 = createEvent({
      title: "Cal A Event",
      calendar_id: calendarId,
      org_id: orgId,
      start_at: "2026-04-15T09:00:00Z",
      end_at: "2026-04-15T10:00:00Z",
    });
    createEvent({
      title: "Cal B Event",
      calendar_id: cal2.id,
      org_id: orgId,
      start_at: "2026-04-15T09:00:00Z",
      end_at: "2026-04-15T10:00:00Z",
    });
    createAttendee({ event_id: evt1.id, agent_id: agentId, display_name: "Agent One" });

    const conflicts = findAgentConflicts(agentId, { start: "2026-04-15T09:30:00Z", end: "2026-04-15T10:30:00Z" });
    expect(conflicts.length).toBe(1);
  });

  test("search events by title", () => {
    createEvent({
      title: "Engineering Standup",
      calendar_id: calendarId,
      org_id: orgId,
      start_at: "2026-04-15T09:00:00Z",
      end_at: "2026-04-15T09:30:00Z",
      description: "Daily sync meeting",
    });
    createEvent({
      title: "Budget Review",
      calendar_id: calendarId,
      org_id: orgId,
      start_at: "2026-04-15T14:00:00Z",
      end_at: "2026-04-15T15:00:00Z",
    });
    const results = searchEvents("standup");
    expect(results.length).toBe(1);
    expect(results[0]!.title).toBe("Engineering Standup");
  });

  test("all day event", () => {
    const evt = createEvent({
      title: "Holiday",
      calendar_id: calendarId,
      org_id: orgId,
      start_at: "2026-04-15T00:00:00Z",
      end_at: "2026-04-15T23:59:59Z",
      all_day: true,
    });
    expect(evt.all_day).toBe(true);
  });

  test("metadata stored", () => {
    const evt = createEvent({
      title: "Video Call",
      calendar_id: calendarId,
      org_id: orgId,
      start_at: "2026-04-15T09:00:00Z",
      end_at: "2026-04-15T10:00:00Z",
      metadata: { video_url: "https://meet.example.com/abc" },
    });
    expect(evt.metadata.video_url).toBe("https://meet.example.com/abc");
  });

  test("list with limit", () => {
    for (let i = 0; i < 5; i++) {
      createEvent({
        title: `Event ${i}`,
        calendar_id: calendarId,
        org_id: orgId,
        start_at: `2026-04-15T0${i}:00:00Z`,
        end_at: `2026-04-15T0${i + 1}:00:00Z`,
      });
    }
    const limited = listEvents({ calendar_id: calendarId, limit: 3 });
    expect(limited.length).toBe(3);
  });
});
