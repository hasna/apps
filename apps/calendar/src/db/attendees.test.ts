import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createEvent } from "./events.js";
import { createCalendar, listCalendars } from "./calendars.js";
import { createOrg } from "./orgs.js";
import { registerAgent } from "./agents.js";
import { createAttendee, getAttendeesForEvent, updateAttendee, deleteAttendee, getEventsForAgent } from "./attendees.js";
import { getDatabase, resetDatabase } from "./database.js";
import { NotFoundError } from "../types/index.js";

describe("attendees", () => {
  let orgId: string;
  let eventId: string;
  let agent1Id: string;
  let agent2Id: string;

  beforeEach(() => {
    resetDatabase();
    const org = createOrg({ name: "Test", slug: "test" });
    orgId = org.id;
    const cal = createCalendar({ name: "Main", org_id: orgId });
    const evt = createEvent({
      title: "Meeting",
      calendar_id: cal.id,
      org_id: orgId,
      start_at: "2026-04-15T09:00:00Z",
      end_at: "2026-04-15T10:00:00Z",
    });
    eventId = evt.id;
    agent1Id = registerAgent({ name: "agent1" }).id;
    agent2Id = registerAgent({ name: "agent2" }).id;
  });

  afterEach(() => resetDatabase());

  test("create attendee with agent_id", () => {
    const a = createAttendee({ event_id: eventId, agent_id: agent1Id, display_name: "Agent One" });
    expect(a.agent_id).toBe(agent1Id);
    expect(a.display_name).toBe("Agent One");
    expect(a.status).toBe("needsAction");
    expect(a.required).toBe(true);
  });

  test("create optional attendee", () => {
    const a = createAttendee({ event_id: eventId, agent_id: agent2Id, required: false });
    expect(a.required).toBe(false);
  });

  test("list attendees for event", () => {
    createAttendee({ event_id: eventId, agent_id: agent1Id, display_name: "A" });
    createAttendee({ event_id: eventId, agent_id: agent2Id, display_name: "B" });
    const attendees = getAttendeesForEvent(eventId);
    expect(attendees.length).toBe(2);
  });

  test("respond to invitation", () => {
    const a = createAttendee({ event_id: eventId, agent_id: agent1Id });
    const updated = updateAttendee(a.id, { status: "accepted", response_comment: "Looking forward to it" });
    expect(updated.status).toBe("accepted");
    expect(updated.response_comment).toBe("Looking forward to it");
    expect(updated.responded_at).not.toBeNull();
  });

  test("get events for agent", () => {
    const evt2 = createEvent({
      title: "Second Meeting",
      calendar_id: (listCalendars(orgId)[0] as any).id,
      org_id: orgId,
      start_at: "2026-04-15T14:00:00Z",
      end_at: "2026-04-15T15:00:00Z",
    });
    createAttendee({ event_id: eventId, agent_id: agent1Id });
    createAttendee({ event_id: evt2.id, agent_id: agent1Id });
    const events = getEventsForAgent(agent1Id);
    expect(events.length).toBe(2);
  });

  test("delete attendee", () => {
    const a = createAttendee({ event_id: eventId, agent_id: agent1Id });
    expect(deleteAttendee(a.id)).toBe(true);
  });

  test("update nonexistent throws", () => {
    expect(() => updateAttendee("nope", { status: "accepted" })).toThrow(NotFoundError);
  });

  test("email attendee without agent", () => {
    const a = createAttendee({ event_id: eventId, email: "human@example.com", display_name: "Human" });
    expect(a.email).toBe("human@example.com");
    expect(a.agent_id).toBeNull();
  });
});
