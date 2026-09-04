import { expect, test } from "bun:test";
import { validateDatabaseUrl } from "../server/database-config.js";
import { ApiStore } from "./api.js";
import { createHttpTransport, createStorageClient } from "./http-storage.js";
import { handleV1Request } from "../server/v1.js";
import { installDomainFixture } from "../test/domain-fixture.js";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { getStore } from "./index.js";
import { createCalendarClient, CalendarV1Client } from "../sdk/index.js";

test("review P1: absent/plaintext/ambiguous PostgreSQL TLS is rejected", () => {
  for (const query of ["", "?sslmode=disable", "?sslmode=prefer", "?sslmode=require", "?sslmode=verify-ca", "?sslmode=verify-full&sslmode=disable", "?sslmode=verify-full&ssl=disable", "?sslmode=verify-full&SSLMODE=disable"]) {
    expect(() => validateDatabaseUrl("postgres://fixture@localhost/calendar_test" + query)).toThrow();
  }
});

test("review P2: SDK and domain list apply every nondefault filter", async () => {
  resetDatabase(":memory:"); const restore = installDomainFixture();
  try {
    const domain = getStore(); const sdk = createCalendarClient();
    const org = await domain.createOrg({ name: "Filter org" });
    const cal = await domain.createCalendar({ name: "Filter calendar", org_id: org.id });
    const a = await domain.registerAgent({ name: "filter-a" });
    const b = await domain.registerAgent({ name: "filter-b" });
    const expected: string[] = [];
    for (let i = 0; i < 6; i++) {
      const event = await domain.createEvent({ title: "Filter " + i, org_id: org.id, calendar_id: cal.id, created_by: i % 2 ? b.id : a.id, source_task_id: "filter-source", status: "confirmed", start_at: `2026-09-0${i + 1}T09:00:00Z`, end_at: `2026-09-0${i + 1}T10:00:00Z` });
      if (i % 2) expected.push(event.id);
    }
    const filter = { org_id: org.id, calendar_id: cal.id, created_by: b.id, source_task_id: "filter-source", status: "confirmed", after: "2026-09-01T00:00:00Z", before: "2026-09-07T00:00:00Z", limit: 1, offset: 1 };
    expect((await domain.listEvents(filter)).map(e => e.id)).toEqual([expected[1]!]);
    expect((await sdk.listEvents(filter)).events?.map(e => e.id)).toEqual([expected[1]!]);
  } finally { restore(); closeDatabase(); }
});

test("review P2: actual 404 remains absence; malformed 200 also fails in generated SDK", async () => {
  const store = new ApiStore(createStorageClient("calendar", createHttpTransport({ name: "calendar", baseUrl: "https://calendar.example.test", apiKey: "fixture", fetchImpl: async () => new Response(null, { status: 404 }) })));
  expect(await store.getOrg("missing")).toBeNull();
  for (const body of [null, [], { org: [] }, { org: null }]) {
    const sdk = new CalendarV1Client({ baseUrl: "https://calendar.example.test", apiKey: "fixture", fetch: (async () => Response.json(body)) as typeof fetch });
    await expect(sdk.getOrg("fixture")).rejects.toThrow();
  }
  const sdk = new CalendarV1Client({ baseUrl: "https://calendar.example.test", apiKey: "fixture", fetch: (async () => Response.json({ availability: [] })) as typeof fetch });
  await expect(sdk.upsertAvailability({ agent_id: "a", org_id: "o", day_of_week: 1, start_time: "09:00", end_time: "17:00" })).rejects.toThrow();
});

test("review P2: malformed successful envelopes are not entities/absence", async () => {
  for (const body of [null, [], { org: null }, { org: [] }]) {
    const store = new ApiStore(createStorageClient("calendar", createHttpTransport({ name: "calendar", baseUrl: "https://calendar.example.test", apiKey: "fixture", fetchImpl: async () => Response.json(body) })));
    await expect(store.getOrg("fixture")).rejects.toThrow();
  }
  const store = new ApiStore(createStorageClient("calendar", createHttpTransport({ name: "calendar", baseUrl: "https://calendar.example.test", apiKey: "fixture", fetchImpl: async () => Response.json({ availability: {} }) })));
  await expect(store.getAvailabilityForAgent("fixture")).rejects.toThrow();
});

test("review P2: event list forwards nondefault offset and creator", async () => {
  let received: unknown;
  const req = new Request("https://calendar.example.test/v1/events?created_by=agent-b&offset=7&limit=3");
  await handleV1Request(req, new URL(req.url), {
    getCloudVerifier: () => ({ authenticate: async () => ({ ok: true }) }),
    getCloudStore: () => ({ listEvents: async (filter: unknown) => { received = filter; return []; } }),
  } as never);
  expect(received).toMatchObject({ created_by: "agent-b", offset: 7, limit: 3 });
});
