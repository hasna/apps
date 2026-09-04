import { expect, test } from "bun:test";
import { CalendarV1Client, createCalendarClient } from "./index.js";
import { getStore } from "../store/index.js";
import { installDomainFixture } from "../test/domain-fixture.js";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { resolveBackend, validateDatabaseUrl } from "../server/cloud.js";

test("SDK and server enforce explicit authenticated authorities", async () => {
  for (const options of [{ baseUrl: "https://calendar.example.test" }, { baseUrl: "http://localhost", apiKey: "fixture" }, { baseUrl: "https://calendar.example.test", apiKey: " " }]) {
    expect(() => new CalendarV1Client(options as never)).toThrow();
  }
  expect(() => createCalendarClient({})).toThrow();
  for (const env of [{}, { HASNA_CALENDAR_DATABASE_URL: " " }, { HASNA_CALENDAR_DATABASE_URL: "sqlite:/tmp/test" }, { HASNA_CALENDAR_DATABASE_URL: "postgres://fixture@localhost/db?sslmode=verify-full", CALENDAR_DATABASE_URL: "postgres://other@localhost/db?sslmode=verify-full" }]) expect(() => resolveBackend(env)).toThrow();
  expect(validateDatabaseUrl("postgres://fixture@localhost/calendar_test?sslmode=verify-full")).toBe("postgres://fixture@localhost/calendar_test?sslmode=verify-full");
  let calls = 0;
  const sdk = new CalendarV1Client({ baseUrl: "https://calendar.example.test/v1", apiKey: "fixture", fetch: (async (_url, init) => {
    calls++;
    expect(init?.redirect).toBe("error");
    return Response.json({ orgs: [] });
  }) as typeof fetch });
  expect(JSON.stringify(sdk)).not.toContain("fixture");
  expect(() => sdk.listOrgs({ redirect: "follow" })).toThrow();
  await expect(sdk.listOrgs({ headers: new Headers({ AUTHORIZATION: "other" }) })).rejects.toThrow();
  expect(await sdk.listOrgs()).toEqual({ orgs: [] });
  expect(calls).toBe(1);
});

test("all 33 generated SDK operations preserve real /v1 routes and envelopes", async () => {
  resetDatabase(":memory:");
  const restore = installDomainFixture();
  try {
    const sdk = createCalendarClient();
    const org = (await sdk.createOrg({ name: "SDK Org", slug: "sdk-org" })).org!;
    expect((await sdk.listOrgs()).orgs).toHaveLength(1);
    expect((await sdk.getOrg(org.id)).org?.id).toBe(org.id);
    expect((await sdk.updateOrg(org.id, { name: "Changed" })).org?.name).toBe("Changed");
    const agent = (await sdk.registerAgent({ name: "sdk-agent" })).agent!;
    expect((await sdk.listAgents()).agents).toHaveLength(1);
    expect((await sdk.getAgent(agent.id)).agent?.id).toBe(agent.id);
    expect((await sdk.updateAgent(agent.id, { role: "tester" })).agent?.role).toBe("tester");
    expect((await sdk.heartbeatAgent(agent.id)).agent?.id).toBe(agent.id);
    const cal = (await sdk.createCalendar({ org_id: org.id, name: "SDK Calendar" })).calendar!;
    expect((await sdk.listCalendars({ org_id: org.id })).calendars).toHaveLength(1);
    expect((await sdk.getCalendar(cal.id)).calendar?.id).toBe(cal.id);
    expect((await sdk.updateCalendar(cal.id, { name: "Changed Calendar" })).calendar?.name).toBe("Changed Calendar");
    const event = (await sdk.createEvent({ org_id: org.id, calendar_id: cal.id, title: "Planning", start_at: "2026-09-03T09:00:00Z", end_at: "2026-09-03T10:00:00Z" })).event!;
    expect((await sdk.listEvents({ calendar_id: cal.id })).events).toHaveLength(1);
    expect((await sdk.getEvent(event.id)).attendees).toEqual([]);
    expect((await sdk.updateEvent(event.id, { title: "Planning Updated" })).event?.title).toBe("Planning Updated");
    expect((await sdk.searchEvents({ q: "Planning" })).events).toHaveLength(1);
    expect((await sdk.findConflicts({ calendar_id: cal.id, start: event.start_at, end: event.end_at })).conflicts).toHaveLength(1);
    const attendee = (await sdk.addAttendee({ event_id: event.id, agent_id: agent.id })).attendee!;
    expect((await sdk.listAttendees({ event_id: event.id })).attendees).toHaveLength(1);
    expect((await sdk.updateAttendee(attendee.id, { status: "accepted" })).attendee?.status).toBe("accepted");
    const availability = (await sdk.upsertAvailability({ agent_id: agent.id, org_id: org.id, day_of_week: 1, start_time: "09:00", end_time: "17:00" })).availability!;
    expect((await sdk.getAvailability({ agent_id: agent.id })).availability).toHaveLength(1);
    const member = (await sdk.addMember({ agent_id: agent.id, org_id: org.id })).member!;
    expect(member.agent_id).toBe(agent.id);
    expect((await sdk.listMembers({ org_id: org.id })).members).toHaveLength(1);
    expect((await sdk.listMembers({ agent_id: agent.id })).members).toHaveLength(1);
    const domain = getStore();
    expect(await domain.getOrgsForAgent(agent.id)).toHaveLength(1);
    expect((await domain.getEventWithAttendees(event.id))?.attendees).toHaveLength(1);
    expect((await sdk.removeMember({ org_id: org.id, agent_id: agent.id })).deleted).toBe(true);
    expect((await sdk.deleteAvailability(availability.id)).deleted).toBe(true);
    expect((await sdk.deleteAttendee(attendee.id)).deleted).toBe(true);
    expect((await sdk.deleteEvent(event.id)).deleted).toBe(true);
    expect((await sdk.deleteCalendar(cal.id)).deleted).toBe(true);
    expect((await sdk.deleteAgent(agent.id)).deleted).toBe(true);
    expect((await sdk.deleteOrg(org.id)).deleted).toBe(true);
  } finally { restore(); closeDatabase(); }
});
