import {
  createOrg, listOrgs, getOrg, getOrgBySlug, updateOrg, deleteOrg,
  registerAgent, getAgent, getAgentByName, listAgents, heartbeat as agentHeartbeat,
  createCalendar, getCalendar, listCalendars, updateCalendar, deleteCalendar,
  createEvent, getEvent, listEvents, updateEvent, deleteEvent, findConflicts, searchEvents,
  createAttendee, getAttendeesForEvent, updateAttendee,
  getAvailabilityForAgent, upsertAgentAvailability,
  createMembership, getMembershipsForOrg,
  closeDatabase,
} from "../index.js";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

type SSEClient = { controller: ReadableStreamDefaultController; orgId?: string; agentId?: string };

export function serve(port: number) {
  const sseClients = new Set<SSEClient>();

  function broadcastEvent(event: { type: string; event_id?: string; action: string; agent_id?: string | null; org_id?: string | null }) {
    const data = `data: ${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n\n`;
    for (const client of sseClients) {
      if (client.orgId && event.org_id !== client.orgId) continue;
      if (client.agentId && event.agent_id !== client.agentId) continue;
      try { client.controller.enqueue(data); } catch { /* client closed */ }
    }
  }

  const server = Bun.serve({
    port,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;

      // ── CORS preflight ────────────────────────────────────────────────────
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        });
      }

      // ── SSE ───────────────────────────────────────────────────────────────
      if (path === "/api/events/stream") {
        const client: SSEClient = {
          controller: null as any,
          orgId: url.searchParams.get("org_id") || undefined,
          agentId: url.searchParams.get("agent_id") || undefined,
        };
        const stream = new ReadableStream({
          start(controller) {
            client.controller = controller;
            sseClients.add(client);
            controller.enqueue(`data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`);
          },
          cancel() { sseClients.delete(client); },
        });
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
        });
      }

      // ── Org routes ────────────────────────────────────────────────────────
      if (path === "/api/orgs" && req.method === "GET") return json(listOrgs());
      if (path === "/api/orgs" && req.method === "POST") {
        const body = await readBody(req);
        const org = createOrg(body as any);
        broadcastEvent({ type: "org.created", action: "created" });
        return json(org, 201);
      }
      if (path.startsWith("/api/orgs/") && req.method === "GET") {
        const id = path.split("/").pop()!;
        const org = getOrg(id) || getOrgBySlug(id);
        return org ? json(org) : error("Org not found", 404);
      }
      if (path.startsWith("/api/orgs/") && req.method === "PUT") {
        const id = path.split("/").pop()!;
        const body = await readBody(req);
        return json(updateOrg(id, body as any));
      }
      if (path.startsWith("/api/orgs/") && req.method === "DELETE") {
        const id = path.split("/").pop()!;
        return json({ deleted: deleteOrg(id) });
      }

      // ── Agent routes ──────────────────────────────────────────────────────
      if (path === "/api/agents" && req.method === "GET") return json(listAgents());
      if (path === "/api/agents" && req.method === "POST") {
        const body = await readBody(req);
        return json(registerAgent(body as any), 201);
      }
      if (path.startsWith("/api/agents/") && path.endsWith("/heartbeat") && req.method === "POST") {
        const id = path.split("/")[3];
        if (!id) return error("Agent ID required", 400);
        agentHeartbeat(id);
        return json({ ok: true });
      }
      if (path.startsWith("/api/agents/") && req.method === "GET") {
        const id = path.split("/").pop()!;
        const agent = getAgent(id) || getAgentByName(id);
        return agent ? json(agent) : error("Agent not found", 404);
      }

      // ── Calendar routes ───────────────────────────────────────────────────
      if (path === "/api/calendars" && req.method === "GET") {
        const orgId = url.searchParams.get("org_id") || undefined;
        return json(listCalendars(orgId));
      }
      if (path === "/api/calendars" && req.method === "POST") {
        const body = await readBody(req);
        return json(createCalendar(body as any), 201);
      }
      if (path.startsWith("/api/calendars/") && req.method === "GET") {
        const id = path.split("/").pop()!;
        const cal = getCalendar(id);
        return cal ? json(cal) : error("Calendar not found", 404);
      }
      if (path.startsWith("/api/calendars/") && req.method === "PUT") {
        const id = path.split("/").pop()!;
        const body = await readBody(req);
        return json(updateCalendar(id, body as any));
      }
      if (path.startsWith("/api/calendars/") && req.method === "DELETE") {
        const id = path.split("/").pop()!;
        return json({ deleted: deleteCalendar(id) });
      }

      // ── Event routes ──────────────────────────────────────────────────────
      if (path === "/api/events" && req.method === "GET") {
        return json(listEvents({
          calendar_id: url.searchParams.get("calendar_id") || undefined,
          org_id: url.searchParams.get("org_id") || undefined,
          after: url.searchParams.get("after") || undefined,
          before: url.searchParams.get("before") || undefined,
          limit: url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!) : undefined,
        }));
      }
      if (path === "/api/events" && req.method === "POST") {
        const body = await readBody(req);
        const evt = createEvent(body as any);
        broadcastEvent({ type: "event.created", event_id: evt.id, action: "created", org_id: evt.org_id });
        return json(evt, 201);
      }
      if (path === "/api/events/search" && req.method === "GET") {
        const query = url.searchParams.get("q") || "";
        const orgId = url.searchParams.get("org_id") || undefined;
        return json(searchEvents(query, orgId));
      }
      if (path === "/api/events/conflicts" && req.method === "GET") {
        const calendarId = url.searchParams.get("calendar_id") || "";
        const start = url.searchParams.get("start") || "";
        const end = url.searchParams.get("end") || "";
        return json(findConflicts(calendarId, { start, end }));
      }
      if (path.startsWith("/api/events/") && req.method === "GET") {
        const id = path.split("/").pop()!;
        const evt = getEvent(id);
        if (!evt) return error("Event not found", 404);
        const attendees = getAttendeesForEvent(id);
        return json({ event: evt, attendees });
      }
      if (path.startsWith("/api/events/") && req.method === "PUT") {
        const id = path.split("/").pop()!;
        const body = await readBody(req);
        return json(updateEvent(id, body as any));
      }
      if (path.startsWith("/api/events/") && req.method === "DELETE") {
        const id = path.split("/").pop()!;
        return json({ deleted: deleteEvent(id) });
      }

      // ── Attendee routes ───────────────────────────────────────────────────
      if (path === "/api/attendees" && req.method === "POST") {
        const body = await readBody(req);
        return json(createAttendee(body as any), 201);
      }
      if (path.startsWith("/api/attendees/") && path.endsWith("/respond") && req.method === "POST") {
        const id = path.split("/")[3];
        if (!id) return error("Attendee ID required", 400);
        const body = await readBody(req);
        return json(updateAttendee(id, body as any));
      }

      // ── Availability routes ───────────────────────────────────────────────
      if (path === "/api/availability" && req.method === "GET") {
        const agentId = url.searchParams.get("agent_id") || "";
        const orgId = url.searchParams.get("org_id") || undefined;
        return json(getAvailabilityForAgent(agentId, orgId));
      }
      if (path === "/api/availability" && req.method === "POST") {
        const body = await readBody(req) as Record<string, any>;
        return json(upsertAgentAvailability(body.agent_id, body.org_id, body.day_of_week, body.start_time, body.end_time), 201);
      }

      // ── Membership routes ─────────────────────────────────────────────────
      if (path === "/api/members" && req.method === "GET") {
        const orgId = url.searchParams.get("org_id") || "";
        return json(getMembershipsForOrg(orgId));
      }
      if (path === "/api/members" && req.method === "POST") {
        const body = await readBody(req);
        return json(createMembership(body as any), 201);
      }

      // ── Health ────────────────────────────────────────────────────────────
      if (path === "/api/health") return json({ status: "ok", uptime: process.uptime() });

      // ── 404 ───────────────────────────────────────────────────────────────
      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`Calendar server listening on http://localhost:${port}`);

  // Graceful shutdown
  process.on("SIGINT", () => {
    closeDatabase();
    server.stop();
    process.exit(0);
  });

  return server;
}
