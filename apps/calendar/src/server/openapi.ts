/**
 * OpenAPI 3.1 document for the calendar `/v1` API (A1 pure-remote).
 *
 * Single source of truth for both the served `GET /openapi.json` and the
 * generated SDK (scripts/generate-sdk.ts → src/sdk/v1.generated.ts).
 */
import { getPackageVersion } from "./version.js";

function ref(name: string) { return { $ref: `#/components/schemas/${name}` }; }

const jsonBody = (schema: unknown, required = true) => ({
  required,
  content: { "application/json": { schema } },
});
const jsonResp = (schema: unknown, description = "OK") => ({
  description,
  content: { "application/json": { schema } },
});

export function buildV1OpenApiDocument(): Record<string, unknown> {
  const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } };

  return {
    openapi: "3.1.0",
    info: {
      title: "Calendar API",
      version: getPackageVersion(),
      description: "Universal calendar management for AI coding agents — versioned /v1 HTTP API (A1 pure-remote).",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      schemas: {
        Org: {
          type: "object",
          properties: {
            id: { type: "string" }, name: { type: "string" }, slug: { type: "string" },
            description: { type: ["string", "null"] }, metadata: { type: "object" },
            created_at: { type: "string" }, updated_at: { type: "string" },
          },
          required: ["id", "name", "slug"],
        },
        CreateOrgInput: {
          type: "object",
          properties: { name: { type: "string" }, slug: { type: "string" }, description: { type: "string" }, metadata: { type: "object" } },
          required: ["name"],
        },
        UpdateOrgInput: {
          type: "object",
          properties: { name: { type: "string" }, description: { type: "string" }, metadata: { type: "object" } },
        },
        Calendar: {
          type: "object",
          properties: {
            id: { type: "string" }, org_id: { type: "string" }, owner_id: { type: ["string", "null"] },
            slug: { type: "string" }, name: { type: "string" }, description: { type: ["string", "null"] },
            color: { type: ["string", "null"] }, timezone: { type: "string" },
            visibility: { type: "string", enum: ["public", "org", "private"] }, metadata: { type: "object" },
            created_at: { type: "string" }, updated_at: { type: "string" },
          },
          required: ["id", "org_id", "slug", "name", "timezone", "visibility"],
        },
        CreateCalendarInput: {
          type: "object",
          properties: {
            org_id: { type: "string" }, owner_id: { type: "string" }, name: { type: "string" }, slug: { type: "string" },
            description: { type: "string" }, color: { type: "string" }, timezone: { type: "string" },
            visibility: { type: "string", enum: ["public", "org", "private"] }, metadata: { type: "object" },
          },
          required: ["org_id", "name"],
        },
        UpdateCalendarInput: {
          type: "object",
          properties: {
            name: { type: "string" }, description: { type: "string" }, color: { type: "string" },
            timezone: { type: "string" }, visibility: { type: "string", enum: ["public", "org", "private"] }, metadata: { type: "object" },
          },
        },
        Event: {
          type: "object",
          properties: {
            id: { type: "string" }, calendar_id: { type: "string" }, org_id: { type: "string" },
            title: { type: "string" }, description: { type: ["string", "null"] }, location: { type: ["string", "null"] },
            start_at: { type: "string" }, end_at: { type: "string" }, all_day: { type: "boolean" }, timezone: { type: "string" },
            status: { type: "string", enum: ["tentative", "confirmed", "cancelled"] },
            busy_type: { type: "string", enum: ["busy", "free", "out_of_office"] },
            visibility: { type: "string", enum: ["default", "private", "confidential"] },
            recurrence_rule: { type: ["string", "null"] },
            recurrence_exception_dates: { type: ["array", "null"], items: { type: "string" } },
            source_task_id: { type: ["string", "null"] }, created_by: { type: ["string", "null"] },
            metadata: { type: "object" }, created_at: { type: "string" }, updated_at: { type: "string" },
          },
          required: ["id", "calendar_id", "org_id", "title", "start_at", "end_at"],
        },
        CreateEventInput: {
          type: "object",
          properties: {
            calendar_id: { type: "string" }, org_id: { type: "string" }, title: { type: "string" },
            description: { type: "string" }, location: { type: "string" }, start_at: { type: "string" }, end_at: { type: "string" },
            all_day: { type: "boolean" }, timezone: { type: "string" },
            status: { type: "string", enum: ["tentative", "confirmed", "cancelled"] },
            busy_type: { type: "string", enum: ["busy", "free", "out_of_office"] },
            visibility: { type: "string", enum: ["default", "private", "confidential"] },
            recurrence_rule: { type: "string" }, recurrence_exception_dates: { type: "array", items: { type: "string" } },
            source_task_id: { type: "string" }, created_by: { type: "string" }, metadata: { type: "object" },
          },
          required: ["calendar_id", "org_id", "title", "start_at", "end_at"],
        },
        UpdateEventInput: {
          type: "object",
          properties: {
            title: { type: "string" }, description: { type: "string" }, location: { type: "string" },
            start_at: { type: "string" }, end_at: { type: "string" }, all_day: { type: "boolean" }, timezone: { type: "string" },
            status: { type: "string", enum: ["tentative", "confirmed", "cancelled"] },
            busy_type: { type: "string", enum: ["busy", "free", "out_of_office"] },
            visibility: { type: "string", enum: ["default", "private", "confidential"] },
            recurrence_rule: { type: "string" }, recurrence_exception_dates: { type: "array", items: { type: "string" } },
            source_task_id: { type: "string" }, metadata: { type: "object" },
          },
        },
        Attendee: {
          type: "object",
          properties: {
            id: { type: "string" }, event_id: { type: "string" }, agent_id: { type: ["string", "null"] },
            display_name: { type: ["string", "null"] }, email: { type: ["string", "null"] },
            status: { type: "string", enum: ["needsAction", "accepted", "declined", "tentative"] },
            required: { type: "boolean" }, response_comment: { type: ["string", "null"] },
            responded_at: { type: ["string", "null"] }, created_at: { type: "string" },
          },
          required: ["id", "event_id", "status"],
        },
        CreateAttendeeInput: {
          type: "object",
          properties: {
            event_id: { type: "string" }, agent_id: { type: "string" }, display_name: { type: "string" },
            email: { type: "string" }, status: { type: "string", enum: ["needsAction", "accepted", "declined", "tentative"] },
            required: { type: "boolean" },
          },
          required: ["event_id"],
        },
        Agent: {
          type: "object",
          properties: {
            id: { type: "string" }, name: { type: "string" }, description: { type: ["string", "null"] },
            role: { type: ["string", "null"] }, status: { type: "string" }, metadata: { type: "object" },
            created_at: { type: "string" }, last_seen_at: { type: "string" },
          },
          required: ["id", "name"],
        },
        RegisterAgentInput: {
          type: "object",
          properties: {
            name: { type: "string" }, description: { type: "string" }, role: { type: "string" },
            title: { type: "string" }, level: { type: "string" }, org_id: { type: "string" },
          },
          required: ["name"],
        },
        Availability: {
          type: "object",
          properties: {
            id: { type: "string" }, agent_id: { type: "string" }, org_id: { type: "string" },
            day_of_week: { type: "integer" }, start_time: { type: "string" }, end_time: { type: "string" },
            exceptions: { type: ["array", "null"], items: { type: "string" } },
            created_at: { type: "string" }, updated_at: { type: "string" },
          },
          required: ["id", "agent_id", "org_id", "day_of_week", "start_time", "end_time"],
        },
        UpsertAvailabilityInput: {
          type: "object",
          properties: {
            agent_id: { type: "string" }, org_id: { type: "string" }, day_of_week: { type: "integer" },
            start_time: { type: "string" }, end_time: { type: "string" },
          },
          required: ["agent_id", "org_id", "day_of_week", "start_time", "end_time"],
        },
        Membership: {
          type: "object",
          properties: {
            id: { type: "string" }, org_id: { type: "string" }, agent_id: { type: "string" },
            role: { type: "string", enum: ["admin", "member", "service"] }, created_at: { type: "string" },
          },
          required: ["id", "org_id", "agent_id", "role"],
        },
        CreateMembershipInput: {
          type: "object",
          properties: {
            org_id: { type: "string" }, agent_id: { type: "string" },
            role: { type: "string", enum: ["admin", "member", "service"] },
          },
          required: ["org_id", "agent_id"],
        },
        DeleteResult: { type: "object", properties: { deleted: { type: "boolean" } }, required: ["deleted"] },
        Error: { type: "object", properties: { error: { type: "string" } }, required: ["error"] },
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      "/v1/orgs": {
        get: { operationId: "listOrgs", summary: "List organizations", responses: { "200": jsonResp({ type: "object", properties: { orgs: { type: "array", items: ref("Org") }, count: { type: "integer" } } }) } },
        post: { operationId: "createOrg", summary: "Create an organization", requestBody: jsonBody(ref("CreateOrgInput")), responses: { "201": jsonResp({ type: "object", properties: { org: ref("Org") } }, "Created") } },
      },
      "/v1/orgs/{id}": {
        get: { operationId: "getOrg", summary: "Get an org by id or slug", parameters: [idParam], responses: { "200": jsonResp({ type: "object", properties: { org: ref("Org") } }), "404": jsonResp(ref("Error"), "Not found") } },
        patch: { operationId: "updateOrg", summary: "Update an org", parameters: [idParam], requestBody: jsonBody(ref("UpdateOrgInput")), responses: { "200": jsonResp({ type: "object", properties: { org: ref("Org") } }) } },
        delete: { operationId: "deleteOrg", summary: "Delete an org", parameters: [idParam], responses: { "200": jsonResp(ref("DeleteResult")) } },
      },
      "/v1/calendars": {
        get: {
          operationId: "listCalendars", summary: "List calendars",
          parameters: [{ name: "org_id", in: "query", schema: { type: "string" } }],
          responses: { "200": jsonResp({ type: "object", properties: { calendars: { type: "array", items: ref("Calendar") }, count: { type: "integer" } } }) },
        },
        post: { operationId: "createCalendar", summary: "Create a calendar", requestBody: jsonBody(ref("CreateCalendarInput")), responses: { "201": jsonResp({ type: "object", properties: { calendar: ref("Calendar") } }, "Created") } },
      },
      "/v1/calendars/{id}": {
        get: { operationId: "getCalendar", summary: "Get a calendar", parameters: [idParam], responses: { "200": jsonResp({ type: "object", properties: { calendar: ref("Calendar") } }), "404": jsonResp(ref("Error"), "Not found") } },
        patch: { operationId: "updateCalendar", summary: "Update a calendar", parameters: [idParam], requestBody: jsonBody(ref("UpdateCalendarInput")), responses: { "200": jsonResp({ type: "object", properties: { calendar: ref("Calendar") } }) } },
        delete: { operationId: "deleteCalendar", summary: "Delete a calendar", parameters: [idParam], responses: { "200": jsonResp(ref("DeleteResult")) } },
      },
      "/v1/events": {
        get: {
          operationId: "listEvents", summary: "List events",
          parameters: [
            { name: "calendar_id", in: "query", schema: { type: "string" } },
            { name: "org_id", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "after", in: "query", schema: { type: "string" } },
            { name: "before", in: "query", schema: { type: "string" } },
            { name: "source_task_id", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
          ],
          responses: { "200": jsonResp({ type: "object", properties: { events: { type: "array", items: ref("Event") }, count: { type: "integer" } } }) },
        },
        post: { operationId: "createEvent", summary: "Create an event", requestBody: jsonBody(ref("CreateEventInput")), responses: { "201": jsonResp({ type: "object", properties: { event: ref("Event") } }, "Created") } },
      },
      "/v1/events/search": {
        get: {
          operationId: "searchEvents", summary: "Full-text search events",
          parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }, { name: "org_id", in: "query", schema: { type: "string" } }],
          responses: { "200": jsonResp({ type: "object", properties: { events: { type: "array", items: ref("Event") }, count: { type: "integer" } } }) },
        },
      },
      "/v1/events/conflicts": {
        get: {
          operationId: "findConflicts", summary: "Find overlapping events in a calendar",
          parameters: [
            { name: "calendar_id", in: "query", required: true, schema: { type: "string" } },
            { name: "start", in: "query", required: true, schema: { type: "string" } },
            { name: "end", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: { "200": jsonResp({ type: "object", properties: { conflicts: { type: "array", items: ref("Event") }, count: { type: "integer" } } }) },
        },
      },
      "/v1/events/{id}": {
        get: { operationId: "getEvent", summary: "Get an event with attendees", parameters: [idParam], responses: { "200": jsonResp({ type: "object", properties: { event: ref("Event"), attendees: { type: "array", items: ref("Attendee") } } }), "404": jsonResp(ref("Error"), "Not found") } },
        patch: { operationId: "updateEvent", summary: "Update an event", parameters: [idParam], requestBody: jsonBody(ref("UpdateEventInput")), responses: { "200": jsonResp({ type: "object", properties: { event: ref("Event") } }) } },
        delete: { operationId: "deleteEvent", summary: "Delete an event", parameters: [idParam], responses: { "200": jsonResp(ref("DeleteResult")) } },
      },
      "/v1/attendees": {
        post: { operationId: "addAttendee", summary: "Add an attendee to an event", requestBody: jsonBody(ref("CreateAttendeeInput")), responses: { "201": jsonResp({ type: "object", properties: { attendee: ref("Attendee") } }, "Created") } },
      },
      "/v1/agents": {
        get: { operationId: "listAgents", summary: "List agents", responses: { "200": jsonResp({ type: "object", properties: { agents: { type: "array", items: ref("Agent") }, count: { type: "integer" } } }) } },
        post: { operationId: "registerAgent", summary: "Register (or upsert) an agent", requestBody: jsonBody(ref("RegisterAgentInput")), responses: { "201": jsonResp({ type: "object", properties: { agent: ref("Agent") } }, "Created") } },
      },
      "/v1/availability": {
        get: {
          operationId: "getAvailability", summary: "Get availability windows for an agent",
          parameters: [{ name: "agent_id", in: "query", required: true, schema: { type: "string" } }, { name: "org_id", in: "query", schema: { type: "string" } }],
          responses: { "200": jsonResp({ type: "object", properties: { availability: { type: "array", items: ref("Availability") }, count: { type: "integer" } } }) },
        },
        post: { operationId: "upsertAvailability", summary: "Upsert an agent availability window", requestBody: jsonBody(ref("UpsertAvailabilityInput")), responses: { "201": jsonResp({ type: "object", properties: { availability: ref("Availability") } }, "Created") } },
      },
      "/v1/members": {
        get: {
          operationId: "listMembers", summary: "List org memberships",
          parameters: [{ name: "org_id", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": jsonResp({ type: "object", properties: { members: { type: "array", items: ref("Membership") }, count: { type: "integer" } } }) },
        },
        post: { operationId: "addMember", summary: "Add an agent to an org", requestBody: jsonBody(ref("CreateMembershipInput")), responses: { "201": jsonResp({ type: "object", properties: { member: ref("Membership") } }, "Created") } },
      },
    },
  };
}
