import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { strict as assert } from "node:assert";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { schemaStatements, resolveCalendarTenantStore } from "./cloud.js";
import { CalendarPgStore } from "./pg-store.js";
import { handleV1Request } from "./v1.js";
import type { CalendarCloudQueryClient } from "./cloud-client.js";

// Explicit throwaway test database only; never accepts a runtime database variable.
const dsn = process.env.CALENDAR_TENANT_TEST_DATABASE_URL;
describe.skipIf(!dsn)("Calendar tenant boundary against PostgreSQL", () => {
  let sql: SQL;
  let client: CalendarCloudQueryClient;
  let a: CalendarPgStore;
  let b: CalendarPgStore;
  const schema = `calendar_tenant_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const secret = "calendar-synthetic-postgres-boundary";
  const verifier = verifyApiKey({ app: "calendar", signingSecret: secret, requireTenant: true, keyStatus: async () => "active" });
  let domainLookups = 0;

  beforeAll(async () => {
    sql = new SQL(dsn!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA ${schema}`);
    await sql.unsafe(`SET search_path TO ${schema}`);
    client = { query: async (q, p = []) => ({ rows: await sql.unsafe(q, [...p]) }), close: async () => {} };
    for (const statement of schemaStatements()) await client.query(statement);
    // Replaying the migration must preserve both schema and ownership.
    for (const statement of schemaStatements()) await client.query(statement);
    await client.query("INSERT INTO calendar_tenants(id) VALUES ('tenant-a'), ('tenant-b')");
    await client.query("INSERT INTO calendar_tenants(id,enabled) VALUES ('disabled-tenant',FALSE)");
    a = new CalendarPgStore(client, "tenant-a"); b = new CalendarPgStore(client, "tenant-b");
  });
  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await sql.close();
  });

  async function request(tid: string | undefined, path: string, method = "GET", body?: unknown) {
    const key = mintApiKey({ app: "calendar", scopes: ["calendar:*"], signingSecret: secret, ...(tid ? { tid } : {}) });
    const req = new Request(`https://calendar.example.test/v1${path}`, { method,
      headers: { "x-api-key": key.token, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return (await handleV1Request(req, new URL(req.url), {
      getCloudVerifier: () => verifier,
      getCloudStore: async (tenantId) => {
        const store = await resolveCalendarTenantStore(client, tenantId);
        if (store) domainLookups++;
        return store;
      },
    }))!;
  }
  async function fixture(store: CalendarPgStore, label: string) {
    const org = await store.createOrg({ name: label, slug: label });
    const agent = await store.registerAgent({ name: label, org_id: org.id });
    const calendar = await store.createCalendar({ org_id: org.id, owner_id: agent.id, name: label });
    const event = await store.createEvent({ org_id: org.id, calendar_id: calendar.id, title: label,
      start_at: "2026-09-18T10:00:00Z", end_at: "2026-09-18T11:00:00Z", created_by: agent.id });
    const attendee = await store.createAttendee({ event_id: event.id, agent_id: agent.id });
    const availability = await store.upsertAgentAvailability(agent.id, org.id, 1, "09:00", "17:00");
    const membership = await store.createMembership({ org_id: org.id, agent_id: agent.id });
    return { org, agent, calendar, event, attendee, availability, membership };
  }

  test("failed ownership migration rolls back its entire additive change", async () => {
    const other = `${schema}_rollback`;
    await sql.unsafe(`CREATE SCHEMA ${other}`);
    try {
      await sql.unsafe(`SET search_path TO ${other}`);
      const statements = schemaStatements();
      for (const statement of statements.slice(0, -1)) await client.query(statement);
      // Occupy the expected unique-index relation name so FK installation fails.
      await client.query("CREATE TABLE orgs_tenant_id_id (unrelated TEXT)");
      await expect(client.query(statements.at(-1)!)).rejects.toThrow();
      expect((await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name='calendar_tenants'", [other])).rows).toEqual([]);
      expect((await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND column_name='tenant_id'", [other])).rows).toEqual([]);
      expect((await client.query("SELECT conname FROM pg_constraint WHERE conrelid='orgs'::regclass AND conname='orgs_slug_key'")).rows).toHaveLength(1);
    } finally {
      await sql.unsafe(`SET search_path TO ${schema}`);
      await sql.unsafe(`DROP SCHEMA ${other} CASCADE`);
    }
  });

  test("migration preserves a complete pre-existing graph without inferring ownership", async () => {
    const other = `${schema}_legacy`;
    const tables = ["orgs", "agents", "calendars", "events", "event_attendees", "availability", "org_memberships"];
    await sql.unsafe(`CREATE SCHEMA ${other}`);
    try {
      await sql.unsafe(`SET search_path TO ${other}`);
 const statements = schemaStatements();
 for (const statement of statements.slice(0,-1)) await client.query(statement);
 await client.query("INSERT INTO orgs(id,name,slug) VALUES('old-org','old','old')");
 await client.query("INSERT INTO agents(id,name,active_org_id) VALUES('old-agent','old','old-org')");
 await client.query("INSERT INTO calendars(id,org_id,owner_id,slug,name) VALUES('old-calendar','old-org','old-agent','old','old')");
 await client.query("INSERT INTO events(id,org_id,calendar_id,created_by,title,start_at,end_at) VALUES('old-event','old-org','old-calendar','old-agent','old','2026-09-18T10:00:00Z','2026-09-18T11:00:00Z')");
 await client.query("INSERT INTO event_attendees(id,event_id,agent_id) VALUES('old-attendee','old-event','old-agent')");
 await client.query("INSERT INTO availability(id,agent_id,org_id,day_of_week,start_time,end_time) VALUES('old-availability','old-agent','old-org',1,'09:00','17:00')");
 await client.query("INSERT INTO org_memberships(id,agent_id,org_id) VALUES('old-member','old-agent','old-org')");
 const before = Object.fromEntries(await Promise.all(tables.map(async t => [t,(await client.query(`SELECT row_to_json(t) AS row FROM ${t} t ORDER BY id`)).rows])));
 await client.query(statements.at(-1)!);
 for (const t of tables) {
   const after = (await client.query(`SELECT to_jsonb(t)-'tenant_id' AS row FROM ${t} t ORDER BY id`)).rows;
   assert.deepEqual(after,before[t]);
   assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${t} WHERE tenant_id IS NOT NULL`)).rows[0].n,0);
 }

 await client.query("INSERT INTO calendar_tenants(id) VALUES('review-tenant')");
 const store = new CalendarPgStore(client,'review-tenant');
 assert.equal((await store.listOrgs()).length,0);
 assert.equal((await store.listAgents()).length,0);
 assert.equal((await store.listCalendars()).length,0);
 assert.equal((await store.listEvents()).length,0);

    } finally {
      await sql.unsafe(`SET search_path TO ${schema}`);
      await sql.unsafe(`DROP SCHEMA ${other} CASCADE`);
    }
  });

  test("all twelve delete edges refuse unassigned legacy descendants", async () => {
    const store = a;
    const org = await store.createOrg({ name: "cascade-matrix" });
    const agent = await store.registerAgent({ name: "cascade-matrix", org_id: org.id });
    const cal = await store.createCalendar({ name: "cascade-matrix", org_id: org.id, owner_id: agent.id });
    const event = await store.createEvent({ title: "cascade-matrix", org_id: org.id, calendar_id: cal.id,
      created_by: agent.id, start_at: "2026-09-18T10:00:00Z", end_at: "2026-09-18T11:00:00Z" });
 const cases = [
 ['org-agent','agents',"INSERT INTO agents(id,name,active_org_id) VALUES('probe','probe',$1)",[org.id],()=>store.deleteOrg(org.id)],
 ['org-calendar','calendars',"INSERT INTO calendars(id,org_id,slug,name) VALUES('probe',$1,'probe','probe')",[org.id],()=>store.deleteOrg(org.id)],
 ['org-event','events',"INSERT INTO events(id,org_id,calendar_id,title,start_at,end_at) VALUES('probe',$1,$2,'probe','2026-09-18T10:00:00Z','2026-09-18T11:00:00Z')",[org.id,cal.id],()=>store.deleteOrg(org.id)],
 ['org-availability','availability',"INSERT INTO availability(id,agent_id,org_id,day_of_week,start_time,end_time) VALUES('probe',$1,$2,1,'09:00','17:00')",[agent.id,org.id],()=>store.deleteOrg(org.id)],
 ['org-member','org_memberships',"INSERT INTO org_memberships(id,agent_id,org_id) VALUES('probe',$1,$2)",[agent.id,org.id],()=>store.deleteOrg(org.id)],
 ['agent-calendar','calendars',"INSERT INTO calendars(id,org_id,owner_id,slug,name) VALUES('probe',$1,$2,'probe','probe')",[org.id,agent.id],()=>store.deleteAgent(agent.id)],
 ['agent-event','events',"INSERT INTO events(id,org_id,calendar_id,created_by,title,start_at,end_at) VALUES('probe',$1,$2,$3,'probe','2026-09-18T10:00:00Z','2026-09-18T11:00:00Z')",[org.id,cal.id,agent.id],()=>store.deleteAgent(agent.id)],
 ['agent-attendee','event_attendees',"INSERT INTO event_attendees(id,event_id,agent_id) VALUES('probe',$1,$2)",[event.id,agent.id],()=>store.deleteAgent(agent.id)],
 ['agent-availability','availability',"INSERT INTO availability(id,agent_id,org_id,day_of_week,start_time,end_time) VALUES('probe',$1,$2,1,'09:00','17:00')",[agent.id,org.id],()=>store.deleteAgent(agent.id)],
 ['agent-member','org_memberships',"INSERT INTO org_memberships(id,agent_id,org_id) VALUES('probe',$1,$2)",[agent.id,org.id],()=>store.deleteAgent(agent.id)],
 ['calendar-event','events',"INSERT INTO events(id,org_id,calendar_id,title,start_at,end_at) VALUES('probe',$1,$2,'probe','2026-09-18T10:00:00Z','2026-09-18T11:00:00Z')",[org.id,cal.id],()=>store.deleteCalendar(cal.id)],
 ['event-attendee','event_attendees',"INSERT INTO event_attendees(id,event_id) VALUES('probe',$1)",[event.id],()=>store.deleteEvent(event.id)],
 ] as const;
 for (const [name,table,insert,params,remove] of cases) {
   await client.query(insert,params);
   let failure: { errno?: unknown; code?: unknown } | undefined;
   try { await remove(); } catch (e) { failure=e as { errno?: unknown; code?: unknown }; }
   assert.ok(failure,`${name} must deny`);
   assert.equal(String(failure?.errno??failure?.code),'23503');
   assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE id='probe' AND tenant_id IS NULL`)).rows[0].n,1);
   assert.ok(await store.getOrg(org.id)); assert.ok(await store.getAgent(agent.id)); assert.ok(await store.getCalendar(cal.id)); assert.ok(await store.getEvent(event.id));
   await client.query(`DELETE FROM ${table} WHERE id='probe'`);

 }
 await store.deleteOrg(org.id);
 assert.equal((await store.getAgent(agent.id))?.active_org_id,null);

  });

  test("missing, unknown and inactive tenant credentials deny before domain access", async () => {
    const before = domainLookups;
    for (const tid of [undefined, "unknown-tenant", "disabled-tenant"]) {
      expect((await request(tid, "/orgs")).status).toBe(403);
      expect((await request(tid, "/orgs", "POST", { name: "must not exist" })).status).toBe(403);
    }
    expect(domainLookups).toBe(before);
  });

  test("every resource query and final mutation remains within its authenticated tenant", async () => {
    // Same names/slugs intentionally overlap in the two tenants.
    const x = await fixture(a, "shared-name");
    const y = await fixture(b, "shared-name");
    expect((await a.getOrg("shared-name"))?.id).toBe(x.org.id);
    expect((await a.getAgent("shared-name"))?.id).toBe(x.agent.id);
    expect(await a.getOrg(y.org.id)).toBeNull();
    expect(await a.getAgent(y.agent.id)).toBeNull();
    expect(await a.getCalendar(y.calendar.id)).toBeNull();
    expect(await a.getEvent(y.event.id)).toBeNull();
    expect(await a.getAttendee(y.attendee.id)).toBeNull();
    expect((await a.listOrgs()).map(r => r.id)).not.toContain(y.org.id);
    expect((await a.listAgents()).map(r => r.id)).not.toContain(y.agent.id);
    expect((await a.listCalendars()).map(r => r.id)).not.toContain(y.calendar.id);
    expect(await a.listCalendars(y.org.id)).toEqual([]);
    expect((await a.listEvents()).map(r => r.id)).not.toContain(y.event.id);
    expect(await a.listEvents({ calendar_id: y.calendar.id })).toEqual([]);
    expect(await a.listEvents({ org_id: y.org.id })).toEqual([]);
    expect((await a.searchEvents("shared-name")).map(r => r.id)).toEqual([x.event.id]);
    expect(await a.searchEvents("shared-name", y.org.id)).toEqual([]);
    expect(await a.findConflicts(y.calendar.id, { start: y.event.start_at, end: y.event.end_at })).toEqual([]);
    expect(await a.getAttendeesForEvent(y.event.id)).toEqual([]);
    expect(await a.getAvailabilityForAgent(y.agent.id)).toEqual([]);
    expect(await a.getAvailabilityForAgent(y.agent.id, y.org.id)).toEqual([]);
    expect(await a.getMembershipsForOrg(y.org.id)).toEqual([]);
    expect(await a.getOrgsForAgent(y.agent.id)).toEqual([]);
    expect(await a.heartbeatAgent(y.agent.id)).toBeNull();
    for (const call of [() => a.updateOrg(y.org.id, { name: "stolen" }),
      () => a.updateAgent(y.agent.id, { description: "stolen" }),
      () => a.updateCalendar(y.calendar.id, { name: "stolen" }),
      () => a.updateEvent(y.event.id, { title: "stolen" }),
      () => a.updateAttendee(y.attendee.id, { status: "accepted" })]) {
      await expect(call()).rejects.toThrow();
    }
    for (const result of await Promise.all([a.deleteOrg(y.org.id), a.deleteAgent(y.agent.id),
      a.deleteCalendar(y.calendar.id), a.deleteEvent(y.event.id), a.deleteAttendee(y.attendee.id),
      a.deleteAvailability(y.availability.id), a.deleteMembershipByAgentAndOrg(y.agent.id, y.org.id)])) expect(result).toBe(false);
    expect(await b.getEvent(y.event.id)).toEqual(y.event);
    expect((await request("tenant-a", `/events/${y.event.id}`)).status).toBe(404);
    expect(await (await request("tenant-a", `/orgs/${y.org.id}`, "DELETE")).json()).toEqual({ deleted: false });
    // Requests alternate and run concurrently against one shared client.
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => request(i % 2 ? "tenant-a" : "tenant-b", "/orgs/shared-name")));
    for (let i = 0; i < results.length; i++) expect((await results[i]!.json()).org.id).toBe(i % 2 ? x.org.id : y.org.id);
    expect((await a.updateAgent(x.agent.id, { description: "owned", capabilities: ["test"] }))?.description).toBe("owned");
    expect((await a.updateOrg(x.org.id, { name: "owned" })).name).toBe("owned");
    expect((await a.updateCalendar(x.calendar.id, { name: "owned" })).name).toBe("owned");
    expect((await a.updateEvent(x.event.id, { title: "owned" })).title).toBe("owned");
    expect((await a.updateAttendee(x.attendee.id, { status: "accepted" })).status).toBe("accepted");
    expect((await a.upsertAgentAvailability(x.agent.id, x.org.id, 1, "10:00", "18:00")).id).toBe(x.availability.id);
  });

  test("all cross-tenant parent references and calendar/org disagreement fail atomically", async () => {
    const x = await fixture(a, "references-a"); const y = await fixture(b, "references-b");
    const extraOrg = await a.createOrg({ name: "other-local-org" });
    const eventInput = { org_id: x.org.id, calendar_id: x.calendar.id, title: "forbidden",
      start_at: x.event.start_at, end_at: x.event.end_at };
    for (const call of [
      () => a.registerAgent({ name: "cross-org", org_id: y.org.id }),
      () => a.updateAgent(x.agent.id, { org_id: y.org.id }),
      () => a.registerAgent({ name: x.agent.name, org_id: y.org.id }),
      () => a.createCalendar({ name: "cross-org", org_id: y.org.id }),
      () => a.createCalendar({ name: "cross-owner", org_id: x.org.id, owner_id: y.agent.id }),
      () => a.createEvent({ ...eventInput, calendar_id: y.calendar.id }),
      () => a.createEvent({ ...eventInput, org_id: extraOrg.id }),
      () => a.createEvent({ ...eventInput, created_by: y.agent.id }),
      () => a.createAttendee({ event_id: y.event.id }),
      () => a.createAttendee({ event_id: x.event.id, agent_id: y.agent.id }),
      () => a.upsertAgentAvailability(y.agent.id, x.org.id, 2, "09:00", "17:00"),
      () => a.upsertAgentAvailability(x.agent.id, y.org.id, 2, "09:00", "17:00"),
      () => a.createMembership({ org_id: y.org.id, agent_id: x.agent.id }),
      () => a.createMembership({ org_id: x.org.id, agent_id: y.agent.id }),
    ]) await expect(call()).rejects.toThrow();
    expect((await a.getAgent(x.agent.id))?.active_org_id).toBe(x.org.id);
    expect((await request("tenant-a", "/calendars", "POST", { name: "forbidden", org_id: y.org.id })).status).toBe(400);
    expect(await a.searchEvents("forbidden")).toEqual([]);
  });

  test("deleting optional parents retains tenant ownership; unassigned descendants are protected", async () => {
    const x = await fixture(a, "delete-parent");
    await a.deleteAgent(x.agent.id);
    expect((await a.getCalendar(x.calendar.id))?.owner_id).toBeNull();
    expect((await a.getEvent(x.event.id))?.created_by).toBeNull();
    const owned = await fixture(a, "legacy-parent");
    await client.query("INSERT INTO event_attendees(id,event_id,email) VALUES ('legacy-attendee',$1,'synthetic@example.test')", [owned.event.id]);
    await expect(a.deleteOrg(owned.org.id)).rejects.toThrow();
    await expect(a.deleteCalendar(owned.calendar.id)).rejects.toThrow();
    await expect(a.deleteEvent(owned.event.id)).rejects.toThrow();
    expect((await client.query("SELECT tenant_id FROM event_attendees WHERE id='legacy-attendee'")).rows).toEqual([{ tenant_id: null }]);
    expect(await a.getAttendee("legacy-attendee")).toBeNull();
    expect(await a.getOrg(owned.org.id)).not.toBeNull();
    await client.query("DELETE FROM event_attendees WHERE id='legacy-attendee'");
    expect(await a.deleteOrg(owned.org.id)).toBe(true);
    expect(await a.getEvent(owned.event.id)).toBeNull();
  });
});
