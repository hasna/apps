/**
 * Versioned `/v1` HTTP API for `calendar-serve` (Amendment A1 pure-remote).
 *
 * Every handler goes through the calendar Postgres store (`getCloudStore`) which
 * reads/writes the shared RDS directly. Auth is enforced by the contracts
 * API-key verifier: reads require `calendar:read`, writes require
 * `calendar:write` (a `calendar:*` key satisfies both). This is a REAL wrapper
 * over the calendar storage lib — there are NO stubs; unknown routes 404.
 */
import { ConflictError, NotFoundError } from "../types/index.js";
import { getCloudStore, getCloudVerifier } from "./cloud.js";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
function error(status: number, message: string, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...(extra ?? {}) }, status);
}
async function readJson<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function mapDomainError(e: unknown): Response {
  if (e instanceof NotFoundError) return error(404, e.message);
  if (e instanceof ConflictError) return error(409, e.message);
  if (e instanceof RangeError) return error(400, e.message);
  throw e;
}

/**
 * Handle a `/v1/*` request. Returns `null` when the path is not a `/v1` route so
 * the caller can fall through to other handlers.
 */
export async function handleV1Request(req: Request, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (path !== "/v1" && !path.startsWith("/v1/")) return null;

  const method = req.method.toUpperCase();
  const isWrite = method !== "GET" && method !== "HEAD";
  const requiredScopes = [isWrite ? "calendar:write" : "calendar:read"];

  // ── Auth (contracts API-key verifier) ──
  let verifier;
  try {
    verifier = getCloudVerifier();
  } catch (e) {
    return error(503, (e as Error).message);
  }
  const decision = await verifier.authenticate(req.headers, { method, path, requiredScopes });
  if (!decision.ok) {
    return error(decision.status, decision.message, { reason: decision.reason });
  }

  // Schema is applied out-of-band by the migration task/runner (owner role);
  // the serve process runs as the least-privilege app role (DML only) and never
  // issues DDL on the request path.
  const store = getCloudStore();

  if (path === "/v1") return json({ service: "calendar", version: "v1" });

  const segments = path.split("/").filter(Boolean); // ["v1", resource, id?, action?]
  const resource = segments[1];
  const id = segments[2];
  const q = url.searchParams;

  try {
    // ── /v1/orgs ──
    if (resource === "orgs") {
      if (!id) {
        if (method === "GET") { const orgs = await store.listOrgs(); return json({ orgs, count: orgs.length }); }
        if (method === "POST") {
          const body = await readJson<{ name?: string }>(req);
          if (!body || typeof body.name !== "string" || !body.name.trim()) return error(400, "name is required");
          return json({ org: await store.createOrg(body as never) }, 201);
        }
        return error(405, `method ${method} not allowed on /v1/orgs`);
      }
      if (method === "GET") { const org = await store.getOrg(id); return org ? json({ org }) : error(404, "org not found"); }
      if (method === "PATCH" || method === "PUT") { return json({ org: await store.updateOrg(id, (await readJson(req)) ?? {}) }); }
      if (method === "DELETE") { return json({ deleted: await store.deleteOrg(id) }); }
      return error(405, `method ${method} not allowed`);
    }

    // ── /v1/calendars ──
    if (resource === "calendars") {
      if (!id) {
        if (method === "GET") { const calendars = await store.listCalendars(q.get("org_id") || undefined); return json({ calendars, count: calendars.length }); }
        if (method === "POST") {
          const body = await readJson<{ org_id?: string; name?: string }>(req);
          if (!body || !body.org_id || !body.name) return error(400, "org_id and name are required");
          return json({ calendar: await store.createCalendar(body as never) }, 201);
        }
        return error(405, `method ${method} not allowed on /v1/calendars`);
      }
      if (method === "GET") { const cal = await store.getCalendar(id); return cal ? json({ calendar: cal }) : error(404, "calendar not found"); }
      if (method === "PATCH" || method === "PUT") { return json({ calendar: await store.updateCalendar(id, (await readJson(req)) ?? {}) }); }
      if (method === "DELETE") { return json({ deleted: await store.deleteCalendar(id) }); }
      return error(405, `method ${method} not allowed`);
    }

    // ── /v1/events ──
    if (resource === "events") {
      if (id === "search" && method === "GET") {
        const events = await store.searchEvents(q.get("q") || "", q.get("org_id") || undefined);
        return json({ events, count: events.length });
      }
      if (id === "conflicts" && method === "GET") {
        const calendarId = q.get("calendar_id");
        const start = q.get("start");
        const end = q.get("end");
        if (!calendarId || !start || !end) return error(400, "calendar_id, start and end are required");
        const conflicts = await store.findConflicts(calendarId, { start, end });
        return json({ conflicts, count: conflicts.length });
      }
      if (!id) {
        if (method === "GET") {
          const events = await store.listEvents({
            calendar_id: q.get("calendar_id") || undefined,
            org_id: q.get("org_id") || undefined,
            status: q.get("status") || undefined,
            after: q.get("after") || undefined,
            before: q.get("before") || undefined,
            source_task_id: q.get("source_task_id") || undefined,
            limit: q.get("limit") ? Number(q.get("limit")) : undefined,
          });
          return json({ events, count: events.length });
        }
        if (method === "POST") {
          const body = await readJson<{ calendar_id?: string; org_id?: string; title?: string; start_at?: string; end_at?: string }>(req);
          if (!body || !body.calendar_id || !body.org_id || !body.title || !body.start_at || !body.end_at) {
            return error(400, "calendar_id, org_id, title, start_at and end_at are required");
          }
          return json({ event: await store.createEvent(body as never) }, 201);
        }
        return error(405, `method ${method} not allowed on /v1/events`);
      }
      if (method === "GET") {
        const event = await store.getEvent(id);
        if (!event) return error(404, "event not found");
        const attendees = await store.getAttendeesForEvent(id);
        return json({ event, attendees });
      }
      if (method === "PATCH" || method === "PUT") { return json({ event: await store.updateEvent(id, (await readJson(req)) ?? {}) }); }
      if (method === "DELETE") { return json({ deleted: await store.deleteEvent(id) }); }
      return error(405, `method ${method} not allowed`);
    }

    // ── /v1/attendees ──
    if (resource === "attendees") {
      if (!id && method === "GET") {
        const eventId = q.get("event_id");
        if (!eventId) return error(400, "event_id is required");
        const attendees = await store.getAttendeesForEvent(eventId);
        return json({ attendees, count: attendees.length });
      }
      if (!id && method === "POST") {
        const body = await readJson<{ event_id?: string }>(req);
        if (!body || !body.event_id) return error(400, "event_id is required");
        return json({ attendee: await store.createAttendee(body as never) }, 201);
      }
      if (id && (method === "PATCH" || method === "PUT")) {
        return json({ attendee: await store.updateAttendee(id, (await readJson(req)) ?? {}) });
      }
      if (id && method === "DELETE") {
        return json({ deleted: await store.deleteAttendee(id) });
      }
      return error(405, `method ${method} not allowed on /v1/attendees`);
    }

    // ── /v1/agents ──
    if (resource === "agents") {
      if (!id) {
        if (method === "GET") { const agents = await store.listAgents(); return json({ agents, count: agents.length }); }
        if (method === "POST") {
          const body = await readJson<{ name?: string }>(req);
          if (!body || !body.name) return error(400, "name is required");
          return json({ agent: await store.registerAgent(body as never) }, 201);
        }
        return error(405, `method ${method} not allowed on /v1/agents`);
      }
      if (segments[3] === "heartbeat" && method === "POST") { const agent = await store.heartbeatAgent(id); return agent ? json({ agent }) : error(404, "agent not found"); }
      if (method === "GET") { const agent = await store.getAgent(id); return agent ? json({ agent }) : error(404, "agent not found"); }
      if (method === "PATCH" || method === "PUT") { return json({ agent: await store.updateAgent(id, (await readJson(req)) ?? {}) }); }
      if (method === "DELETE") { return json({ deleted: await store.deleteAgent(id) }); }
      return error(405, `method ${method} not allowed`);
    }

    // ── /v1/availability ──
    if (resource === "availability") {
      if (method === "GET") {
        const agentId = q.get("agent_id");
        if (!agentId) return error(400, "agent_id is required");
        const availability = await store.getAvailabilityForAgent(agentId, q.get("org_id") || undefined);
        return json({ availability, count: availability.length });
      }
      if (method === "POST") {
        const body = await readJson<{ agent_id?: string; org_id?: string; day_of_week?: number; start_time?: string; end_time?: string }>(req);
        if (!body || !body.agent_id || !body.org_id || body.day_of_week === undefined || !body.start_time || !body.end_time) {
          return error(400, "agent_id, org_id, day_of_week, start_time and end_time are required");
        }
        return json({ availability: await store.upsertAgentAvailability(body.agent_id, body.org_id, body.day_of_week, body.start_time, body.end_time) }, 201);
      }
      if (id && method === "DELETE") {
        return json({ deleted: await store.deleteAvailability(id) });
      }
      return error(405, `method ${method} not allowed on /v1/availability`);
    }

    // ── /v1/members ──
    if (resource === "members") {
      if (method === "GET") {
        const agentId = q.get("agent_id");
        if (agentId) {
          const members = await store.getOrgsForAgent(agentId);
          return json({ members, count: members.length });
        }
        const orgId = q.get("org_id");
        if (!orgId) return error(400, "org_id or agent_id is required");
        const members = await store.getMembershipsForOrg(orgId);
        return json({ members, count: members.length });
      }
      if (method === "POST") {
        const body = await readJson<{ org_id?: string; agent_id?: string }>(req);
        if (!body || !body.org_id || !body.agent_id) return error(400, "org_id and agent_id are required");
        return json({ member: await store.createMembership(body as never) }, 201);
      }
      if (method === "DELETE") {
        const agentId = q.get("agent_id");
        const orgId = q.get("org_id");
        if (!agentId || !orgId) return error(400, "agent_id and org_id are required");
        return json({ deleted: await store.deleteMembershipByAgentAndOrg(agentId, orgId) });
      }
      return error(405, `method ${method} not allowed on /v1/members`);
    }

    return error(404, `unknown resource: ${resource}`);
  } catch (e) {
    return mapDomainError(e);
  }
}
