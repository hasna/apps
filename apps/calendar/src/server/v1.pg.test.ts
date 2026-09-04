/**
 * Integration proof for hasna/calendar#13: a `/v1` write that references a row
 * which does not exist must answer 400, not 500.
 *
 * The unit tests in v1.test.ts mock the store, so they can only ever be as
 * accurate as the error fixture they invent — and the first cut of this fix
 * shipped broken precisely because that fixture described a driver we do not
 * run. This file removes the fixture entirely: it drives the REAL
 * `handleV1Request` through the REAL `CalendarPgStore` over a REAL Bun.SQL
 * connection, so the SQLSTATE mapping is checked against whatever shape the
 * driver actually throws today.
 *
 * Opt in by pointing `CALENDAR_TEST_DATABASE_URL` at a THROWAWAY database:
 *
 *   CALENDAR_TEST_DATABASE_URL=postgres://user@localhost:5432/calendar_test?sslmode=verify-full \
 *     bun test src/server/v1.pg.test.ts
 *
 * Skipped when the variable is absent so `bun test` stays runnable with no
 * Postgres. The env var is deliberately NOT one of the runtime DSN names, so
 * the test-env scrubber (src/test/env-isolation.preload.ts) cannot strip it and
 * a station's live deployment DSN can never be picked up by accident. Setup
 * applies the committed schema via `schemaStatements()` — the same idempotent
 * `CREATE TABLE IF NOT EXISTS` statements the migration runner uses, which never
 * drop or rewrite existing tables. Every foreign-key case writes zero rows; the
 * one happy-path row is removed in `afterAll`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaStatements } from "./cloud.js";
import { createCalendarCloudQueryClient, type CalendarCloudQueryClient } from "./cloud-client.js";
import { CalendarPgStore } from "./pg-store.js";
import { handleV1Request } from "./v1.js";

const DSN = process.env.CALENDAR_TEST_DATABASE_URL;

let client: CalendarCloudQueryClient;
let dependencies: Parameters<typeof handleV1Request>[2];
const createdOrgIds: string[] = [];

async function post(path: string, body: Record<string, unknown>): Promise<Response> {
  const request = new Request(`https://calendar.test${path}`, {
    method: "POST",
    headers: { Authorization: "Bearer integration-test-key", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await handleV1Request(request, new URL(request.url), dependencies))!;
}

describe.skipIf(!DSN)("/v1 foreign keys against a real Postgres", () => {
  beforeAll(async () => {
    client = createCalendarCloudQueryClient(DSN!, { max: 2 });
    for (const stmt of schemaStatements()) await client.query(stmt);
    const store = new CalendarPgStore(client);
    dependencies = {
      getCloudVerifier: () => ({ authenticate: async () => ({ ok: true }) }) as never,
      getCloudStore: () => store as never,
    };
  });

  afterAll(async () => {
    if (!client) return;
    for (const id of createdOrgIds) await client.query("DELETE FROM orgs WHERE id = $1", [id]);
    await client.close();
  });

  test("the issue #13 payload (org_id: \"undefined\") returns 400, not a 500", async () => {
    const response = await post("/v1/calendars", { org_id: "undefined", name: "No org" });
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toEqual({ error: "referenced resource does not exist" });
    expect(text).not.toContain("PostgresError");
    expect(text).not.toContain("23503");
    expect(text).not.toContain("calendars_org_id_fkey");
  });

  test("a calendar referencing a missing org returns 400", async () => {
    const response = await post("/v1/calendars", { org_id: "missing-org", name: "Bad reference" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "referenced resource does not exist" });
  });

  test("an attendee referencing a missing event returns 400", async () => {
    const response = await post("/v1/attendees", {
      event_id: "missing-event",
      email: "person@example.com",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "referenced resource does not exist" });
  });

  test("a non-string calendar name returns 400, not an uncaught TypeError", async () => {
    const orgResponse = await post("/v1/orgs", { name: `name-probe-${crypto.randomUUID().slice(0, 8)}` });
    expect(orgResponse.status).toBe(201);
    const { org } = (await orgResponse.json()) as { org: { id: string } };
    createdOrgIds.push(org.id);

    // A real org id, so the org_id guard passes and `name` is the only thing
    // left to break: `slugify(42)` throws a TypeError that mapDomainError
    // re-throws, which escapes Bun.serve's fetch as a 500.
    const response = await post("/v1/calendars", { org_id: org.id, name: 42 });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "name is required" });
  });

  test("a valid calendar write still returns 201", async () => {
    const orgResponse = await post("/v1/orgs", { name: `fk-probe-${crypto.randomUUID().slice(0, 8)}` });
    expect(orgResponse.status).toBe(201);
    const { org } = (await orgResponse.json()) as { org: { id: string } };
    createdOrgIds.push(org.id);

    const response = await post("/v1/calendars", { org_id: org.id, name: "Valid" });

    expect(response.status).toBe(201);
    const { calendar } = (await response.json()) as { calendar: { org_id: string; name: string } };
    expect(calendar.org_id).toBe(org.id);
    expect(calendar.name).toBe("Valid");
  });
});
