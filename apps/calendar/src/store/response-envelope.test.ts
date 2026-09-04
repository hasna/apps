import { expect, test } from "bun:test";
import { closeDatabase, resetDatabase } from "../db/database.js";
import { createCalendarClient } from "../sdk/index.js";
import { installDomainFixture } from "../test/domain-fixture.js";
import { getStore } from "./index.js";
import { CalendarResponseError, validateResponseEnvelope } from "./response-envelope.js";

for (const name of ["search", "conflicts"]) {
  test(`reserved event action '${name}' remains a valid org slug and agent name`, async () => {
    resetDatabase(":memory:");
    const restore = installDomainFixture();
    try {
      const store = getStore();
      const sdk = createCalendarClient();
      const org = await store.createOrg({ name: `Org ${name}`, slug: name });
      const agent = await store.registerAgent({ name });

      expect((await store.getOrg(name))?.id).toBe(org.id);
      expect((await sdk.getOrg(name)).org?.id).toBe(org.id);
      expect((await store.getAgent(name))?.id).toBe(agent.id);
      expect((await sdk.getAgent(name)).agent?.id).toBe(agent.id);
      expect((await store.heartbeatAgent(name))?.id).toBe(agent.id);
      expect((await sdk.heartbeatAgent(name)).agent?.id).toBe(agent.id);

      expect((await store.updateOrg(org.id, { name: "Changed" })).name).toBe("Changed");
      expect((await sdk.updateAgent(agent.id, { description: "Changed" })).agent?.description).toBe("Changed");
      expect(await store.deleteAgent(agent.id)).toBe(true);
      expect((await sdk.deleteOrg(org.id)).deleted).toBe(true);
      expect(await store.getAgent(name)).toBeNull();
      expect(await store.getOrg(name)).toBeNull();
    } finally {
      restore();
      closeDatabase();
    }
  });
}

test("real event search/conflicts preserve empty and nonempty domain and SDK responses", async () => {
  resetDatabase(":memory:");
  const restore = installDomainFixture();
  try {
    const store = getStore();
    const sdk = createCalendarClient();
    const org = await store.createOrg({ name: "Envelope org" });
    const calendar = await store.createCalendar({ name: "Envelope calendar", org_id: org.id });
    const range = { start: "2026-09-03T09:00:00Z", end: "2026-09-03T10:00:00Z" };
    const query = { calendar_id: calendar.id, ...range };

    expect(await store.searchEvents("Planning", org.id)).toEqual([]);
    expect(await sdk.searchEvents({ q: "Planning", org_id: org.id })).toEqual({ events: [], count: 0 });
    expect(await store.findConflicts(calendar.id, range)).toEqual([]);
    expect(await sdk.findConflicts(query)).toEqual({ conflicts: [], count: 0 });

    const event = await store.createEvent({ org_id: org.id, calendar_id: calendar.id, title: "Planning", start_at: range.start, end_at: range.end });
    expect((await store.searchEvents("Planning", org.id)).map(value => value.id)).toEqual([event.id]);
    expect((await sdk.searchEvents({ q: "Planning", org_id: org.id })).events?.map(value => value.id)).toEqual([event.id]);
    expect((await store.findConflicts(calendar.id, range)).map(value => value.id)).toEqual([event.id]);
    expect((await sdk.findConflicts(query)).conflicts?.map(value => value.id)).toEqual([event.id]);
  } finally {
    restore();
    closeDatabase();
  }
});

test("event query names select special envelopes only on event GET operations", () => {
  for (const name of ["search", "conflicts"]) {
    for (const [resource, key] of [["orgs", "org"], ["agents", "agent"], ["calendars", "calendar"], ["attendees", "attendee"], ["events", "event"]]) {
      for (const prefix of ["", "/v1"]) {
        const path = `${prefix}/${resource}/${name}`;
        if (resource !== "events" && resource !== "attendees") {
          expect(() => validateResponseEnvelope("GET", path, { [key!]: { id: name } })).not.toThrow();
          expect(() => validateResponseEnvelope("GET", path, { [resource!]: [] })).toThrow(CalendarResponseError);
        }
        for (const method of ["PATCH", "PUT"]) {
          expect(() => validateResponseEnvelope(method, path, { [key!]: { id: name } })).not.toThrow();
          expect(() => validateResponseEnvelope(method, path, { conflicts: [] })).toThrow(CalendarResponseError);
        }
        for (const deleted of [true, false]) {
          expect(() => validateResponseEnvelope("DELETE", path, { deleted })).not.toThrow();
        }
      }
    }
    for (const prefix of ["", "/v1"]) {
      expect(() => validateResponseEnvelope("POST", `${prefix}/agents/${name}/heartbeat`, { agent: { id: name } })).not.toThrow();
      const path = `${prefix}/events/${name}`;
      const key = name === "search" ? "events" : "conflicts";
      for (const values of [[], [{ id: "event-id" }]]) {
        expect(() => validateResponseEnvelope("GET", path, { [key]: values })).not.toThrow();
      }
      for (const body of [{ event: { id: "event-id" }, attendees: [] }, { [key]: {} }, { [key]: [null] }, { [key]: [{ id: "" }] }]) {
        expect(() => validateResponseEnvelope("GET", path, body)).toThrow(CalendarResponseError);
      }
    }
  }
});
