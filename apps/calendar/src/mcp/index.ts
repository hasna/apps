import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createOrg, getOrg, getOrgBySlug, listOrgs,
  registerAgent, getAgent, getAgentByName, listAgents, heartbeat as agentHeartbeat,
  createCalendar, listCalendars,
  createEvent, getEvent, listEvents, updateEvent, deleteEvent, findConflicts, searchEvents,
  createAttendee, getAttendeesForEvent, updateAttendee,
  getAvailabilityForAgent, upsertAgentAvailability,
  createMembership, getMembershipsForOrg, getOrgsForAgent,
} from "../index.js";
import { parseHttpArgv, resolveMcpHttpPort } from "./http.js";

const packageJson = await Bun.file(new URL("../../package.json", import.meta.url)).json() as { version: string };
const DEFAULT_TOOL_LIMIT = 20;
const MAX_TOOL_LIMIT = 100;

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "open-calendar",
    version: packageJson.version,
  });

  // ── Org tools ────────────────────────────────────────────────────────────────

  server.tool("create_org",
    "Create a new organization. Every calendar/agent must belong to an org.",
    {
      name: z.string().describe("Org name"),
      slug: z.string().optional().describe("URL-friendly slug (auto-generated from name if omitted)"),
      description: z.string().optional(),
    },
    async ({ name, slug, description }) => {
      const org = createOrg({ name, slug, description });
      return { content: [{ type: "text", text: JSON.stringify(org) }] };
    },
  );

  server.tool("list_orgs",
    "List all organizations",
    pageArgsSchema(),
    async (input) => {
      const orgs = listOrgs();
      return toolResult(compactPage(orgs, input, compactOrg, "Set verbose=true or call get_org for full records."));
    },
  );

  server.tool("get_org",
    "Get an org by ID or slug",
    { idOrSlug: z.string().describe("Org ID or slug") },
    async ({ idOrSlug }) => {
      const org = getOrg(idOrSlug) || getOrgBySlug(idOrSlug);
      if (!org) return { content: [{ type: "text", text: "Org not found" }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(org) }] };
    },
  );

  // ── Agent tools ──────────────────────────────────────────────────────────────

  server.tool("register_agent",
    "Register an agent with the calendar system",
    {
      name: z.string().describe("Agent name (unique)"),
      description: z.string().optional(),
      role: z.string().optional(),
      capabilities: z.array(z.string()).optional(),
      org_id: z.string().optional(),
    },
    async (input) => {
      const agent = registerAgent(input);
      return { content: [{ type: "text", text: JSON.stringify(agent) }] };
    },
  );

  server.tool("list_agents",
    "List all registered agents",
    pageArgsSchema(),
    async (input) => {
      return toolResult(compactPage(listAgents(), input, compactAgent, "Set verbose=true for session/capability fields."));
    },
  );

  server.tool("heartbeat",
    "Update agent last_seen_at timestamp",
    { name: z.string().describe("Agent name") },
    async ({ name }) => {
      const agent = getAgentByName(name);
      if (!agent) return { content: [{ type: "text", text: "Agent not found" }], isError: true };
      agentHeartbeat(agent.id);
      return { content: [{ type: "text", text: `Heartbeat updated for ${name}` }] };
    },
  );

  // ── Calendar tools ───────────────────────────────────────────────────────────

  server.tool("create_calendar",
    "Create a new calendar within an org",
    {
      org_id: z.string().describe("Org ID"),
      name: z.string().describe("Calendar name"),
      slug: z.string().optional(),
      description: z.string().optional(),
      color: z.string().optional().describe("Hex color code"),
      timezone: z.string().optional().describe("IANA timezone, e.g. America/New_York"),
      visibility: z.enum(["public", "org", "private"]).optional(),
    },
    async (input) => {
      const cal = createCalendar({ ...input, timezone: input.timezone || "UTC", visibility: input.visibility || "org" });
      return { content: [{ type: "text", text: JSON.stringify(cal) }] };
    },
  );

  server.tool("list_calendars",
    "List calendars, optionally filtered by org",
    { org_id: z.string().optional(), ...pageArgsSchema() },
    async ({ org_id, ...page }) => {
      return toolResult(compactPage(listCalendars(org_id), page, compactCalendar, "Set verbose=true for descriptions/metadata."));
    },
  );

  // ── Event tools ──────────────────────────────────────────────────────────────

  server.tool("create_event",
    "Create a calendar event with optional recurrence (RRULE) and attendees",
    {
      calendar_id: z.string().describe("Calendar ID"),
      org_id: z.string().describe("Org ID"),
      title: z.string().describe("Event title"),
      start_at: z.string().describe("Start time (ISO 8601)"),
      end_at: z.string().describe("End time (ISO 8601)"),
      description: z.string().optional(),
      location: z.string().optional(),
      all_day: z.boolean().optional(),
      timezone: z.string().optional(),
      status: z.enum(["tentative", "confirmed", "cancelled"]).optional(),
      busy_type: z.enum(["busy", "free", "out_of_office"]).optional(),
      visibility: z.enum(["default", "private", "confidential"]).optional(),
      recurrence_rule: z.string().optional().describe("RRULE string, e.g. FREQ=WEEKLY;BYDAY=MO"),
      source_task_id: z.string().optional().describe("Link to open-todos task"),
      created_by: z.string().optional().describe("Agent ID of creator"),
    },
    async (input) => {
      const evt = createEvent({ ...input, timezone: input.timezone || "UTC", status: input.status || "confirmed", busy_type: input.busy_type || "busy", visibility: input.visibility || "default" });
      return { content: [{ type: "text", text: JSON.stringify(evt) }] };
    },
  );

  server.tool("list_events",
    "List events with optional filters for calendar, org, date range",
    {
      calendar_id: z.string().optional(),
      org_id: z.string().optional(),
      after: z.string().optional().describe("Events starting after this ISO date"),
      before: z.string().optional().describe("Events starting before this ISO date"),
      limit: z.number().int().positive().max(MAX_TOOL_LIMIT).optional(),
      cursor: z.number().int().nonnegative().optional(),
      verbose: z.boolean().optional().describe("Return full records for the selected page"),
    },
    async ({ limit, cursor, verbose, ...filter }) => {
      return toolResult(compactPage(listEvents(filter), { limit, cursor, verbose }, compactEvent, "Set verbose=true or call get_event for full event records."));
    },
  );

  server.tool("get_event",
    "Get event details including attendees",
    { id: z.string().describe("Event ID") },
    async ({ id }) => {
      const evt = getEvent(id);
      if (!evt) return { content: [{ type: "text", text: "Event not found" }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(evt) }] };
    },
  );

  server.tool("update_event",
    "Update event fields",
    {
      id: z.string().describe("Event ID"),
      title: z.string().optional(),
      start_at: z.string().optional(),
      end_at: z.string().optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      status: z.enum(["tentative", "confirmed", "cancelled"]).optional(),
      recurrence_rule: z.string().nullable().optional(),
    },
    async ({ id, ...rest }) => {
      const evt = updateEvent(id, rest);
      return { content: [{ type: "text", text: JSON.stringify(evt) }] };
    },
  );

  server.tool("delete_event",
    "Delete an event",
    { id: z.string().describe("Event ID") },
    async ({ id }) => {
      const ok = deleteEvent(id);
      return { content: [{ type: "text", text: ok ? "Deleted" : "Not found" }] };
    },
  );

  server.tool("search_events",
    "Full-text search across event titles, descriptions, and locations",
    {
      query: z.string().describe("Search query"),
      org_id: z.string().optional(),
      ...pageArgsSchema(),
    },
    async ({ query, org_id, ...page }) => {
      return toolResult(compactPage(searchEvents(query, org_id), page, compactEvent, "Set verbose=true or call get_event for full event records."));
    },
  );

  server.tool("find_conflicts",
    "Find events that overlap with a given time range in a calendar",
    {
      calendar_id: z.string().describe("Calendar ID"),
      start: z.string().describe("Start time (ISO 8601)"),
      end: z.string().describe("End time (ISO 8601)"),
      ...pageArgsSchema(),
    },
    async ({ calendar_id, start, end, ...page }) => {
      return toolResult(compactPage(findConflicts(calendar_id, { start, end }), page, compactEvent, "Set verbose=true or call get_event for full event records."));
    },
  );

  // ── Attendee tools ───────────────────────────────────────────────────────────

  server.tool("add_attendee",
    "Add an attendee to an event",
    {
      event_id: z.string().describe("Event ID"),
      agent_id: z.string().optional(),
      display_name: z.string().optional(),
      email: z.string().optional(),
      required: z.boolean().optional().default(true),
    },
    async (input) => {
      return { content: [{ type: "text", text: JSON.stringify(createAttendee(input)) }] };
    },
  );

  server.tool("list_attendees",
    "List all attendees for an event",
    { event_id: z.string().describe("Event ID"), ...pageArgsSchema() },
    async ({ event_id, ...page }) => {
      return toolResult(compactPage(getAttendeesForEvent(event_id), page, compactAttendee, "Set verbose=true for response comments."));
    },
  );

  server.tool("respond_to_event",
    "Accept, decline, or tentatively respond to an event invitation",
    {
      attendee_id: z.string().describe("Attendee ID"),
      status: z.enum(["accepted", "declined", "tentative"]),
      comment: z.string().optional(),
    },
    async ({ attendee_id, status, comment }) => {
      return { content: [{ type: "text", text: JSON.stringify(updateAttendee(attendee_id, { status, response_comment: comment || null })) }] };
    },
  );

  // ── Availability tools ───────────────────────────────────────────────────────

  server.tool("set_availability",
    "Set agent availability window for a day of week",
    {
      agent_id: z.string(),
      org_id: z.string(),
      day_of_week: z.number().min(0).max(6).describe("0=Sunday, 6=Saturday"),
      start_time: z.string().describe("HH:mm"),
      end_time: z.string().describe("HH:mm"),
    },
    async ({ agent_id, org_id, day_of_week, start_time, end_time }) => {
      return { content: [{ type: "text", text: JSON.stringify(upsertAgentAvailability(agent_id, org_id, day_of_week, start_time, end_time)) }] };
    },
  );

  server.tool("get_availability",
    "Get agent's availability schedule",
    {
      agent_id: z.string(),
      org_id: z.string().optional(),
      ...pageArgsSchema(),
    },
    async ({ agent_id, org_id, ...page }) => {
      return toolResult(compactPage(getAvailabilityForAgent(agent_id, org_id), page, compactAvailability, "Set verbose=true for IDs and timestamps."));
    },
  );

  // ── Membership tools ─────────────────────────────────────────────────────────

  server.tool("add_member",
    "Add an agent to an organization",
    {
      org_id: z.string(),
      agent_id: z.string(),
      role: z.enum(["admin", "member", "service"]).optional(),
    },
    async (input) => {
      return { content: [{ type: "text", text: JSON.stringify(createMembership(input)) }] };
    },
  );

  server.tool("list_members",
    "List all members of an org",
    { org_id: z.string(), ...pageArgsSchema() },
    async ({ org_id, ...page }) => {
      return toolResult(compactPage(getMembershipsForOrg(org_id), page, compactMembership, "Set verbose=true for membership IDs."));
    },
  );

  // ── Bootstrap ────────────────────────────────────────────────────────────────

  server.tool("bootstrap",
    "One-call startup: get org info, calendars, and next event",
    {
      agent_id: z.string().describe("Agent name or ID"),
      ...pageArgsSchema(),
    },
    async ({ agent_id, ...page }) => {
      const agent = getAgentByName(agent_id) || getAgent(agent_id);
      if (!agent) return { content: [{ type: "text", text: `Agent not found: ${agent_id}` }], isError: true };
      agentHeartbeat(agent.id);
      const orgs = getOrgsForAgent(agent.id);
      const calendars = orgs.length > 0 ? listCalendars(orgs[0]!.org_id) : [];
      const now = new Date().toISOString();
      const events = calendars.length > 0 ? listEvents({ org_id: orgs[0]!.org_id, after: now }) : [];
      return toolResult({
        agent: page.verbose ? agent : compactAgent(agent),
        orgs: compactPage(orgs, page, compactMembership, "Set verbose=true for full membership records."),
        calendars: compactPage(calendars, page, compactCalendar, "Set verbose=true for full calendar records."),
        upcoming: compactPage(events, page, compactEvent, "Set verbose=true or call get_event for full event records."),
        hint: "Use limit/cursor to page each section; set verbose=true for full records.",
      });
    },
  );

  return server;
}

type PageArgs = { limit?: number; cursor?: number; verbose?: boolean };

function pageArgsSchema() {
  return {
    limit: z.number().int().positive().max(MAX_TOOL_LIMIT).optional().describe(`Max returned items (default ${DEFAULT_TOOL_LIMIT}, max ${MAX_TOOL_LIMIT})`),
    cursor: z.number().int().nonnegative().optional().describe("Zero-based item offset for the next page"),
    verbose: z.boolean().optional().describe("Return full records for the selected page"),
  };
}

function toolResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function compactPage<T>(items: T[], args: PageArgs, summarize: (item: T) => unknown, hint: string) {
  const cursor = args.cursor ?? 0;
  const limit = Math.min(args.limit ?? DEFAULT_TOOL_LIMIT, MAX_TOOL_LIMIT);
  const page = items.slice(cursor, cursor + limit);
  const nextCursor = cursor + page.length < items.length ? cursor + page.length : null;
  return {
    items: args.verbose ? page : page.map(summarize),
    total: items.length,
    limit,
    cursor,
    next_cursor: nextCursor,
    hint,
  };
}

function compactText(value: string | null | undefined, max = 80): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

function compactOrg(org: ReturnType<typeof listOrgs>[number]) {
  return { id: org.id, slug: org.slug, name: org.name, description: compactText(org.description) };
}

function compactAgent(agent: ReturnType<typeof listAgents>[number]) {
  return { id: agent.id, name: agent.name, status: agent.status, role: agent.role, last_seen_at: agent.last_seen_at };
}

function compactCalendar(calendar: ReturnType<typeof listCalendars>[number]) {
  return { id: calendar.id, slug: calendar.slug, name: calendar.name, org_id: calendar.org_id, timezone: calendar.timezone, visibility: calendar.visibility };
}

function compactEvent(event: ReturnType<typeof listEvents>[number]) {
  return {
    id: event.id,
    title: compactText(event.title, 80),
    start_at: event.start_at,
    end_at: event.end_at,
    status: event.status,
    calendar_id: event.calendar_id,
    location: compactText(event.location, 60),
  };
}

function compactAttendee(attendee: ReturnType<typeof getAttendeesForEvent>[number]) {
  return { id: attendee.id, agent_id: attendee.agent_id, display_name: attendee.display_name, email: attendee.email, status: attendee.status, required: attendee.required };
}

function compactAvailability(availability: ReturnType<typeof getAvailabilityForAgent>[number]) {
  return { id: availability.id, agent_id: availability.agent_id, org_id: availability.org_id, day_of_week: availability.day_of_week, start_time: availability.start_time, end_time: availability.end_time };
}

function compactMembership(membership: ReturnType<typeof getMembershipsForOrg>[number]) {
  return { id: membership.id, org_id: membership.org_id, agent_id: membership.agent_id, role: membership.role };
}

async function main() {
  const { http, port } = parseHttpArgv();
  if (http) {
    const { serve } = await import("../server/serve.js");
    serve(resolveMcpHttpPort(port));
    return;
  }

  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
