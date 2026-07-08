// ApiStore — the self_hosted / cloud transport for `CalendarStore`.
//
// Routes every read and write to `https://<host>/v1/<resource>` with the bearer
// key, then unwraps the `/v1` response envelopes ({ org }, { orgs }, { event },
// { deleted }, ...) so callers get the same shapes LocalStore returns. Both
// `self_hosted` and `cloud` use this identical client — only the URL/key differ
// (that distinction is server-side tenancy, never client code).
//
// SAFETY: the API key lives only inside the transport closure (set at
// construction) and travels only in request headers. It is never logged,
// returned, or embedded in any value this module produces. There is never a DB
// DSN on this path.

import { HasnaHttpError, type StorageClient, type QueryParams } from "./http-storage.js";
import type {
  Org, CreateOrgInput, UpdateOrgInput,
  Agent, RegisterAgentInput,
  Calendar, CreateCalendarInput, UpdateCalendarInput,
  Event, CreateEventInput, UpdateEventInput,
  EventAttendee, CreateAttendeeInput, UpdateAttendeeInput,
  Availability,
  OrgMembership, CreateOrgMembershipInput,
} from "../types/index.js";
import type { CalendarStore, EventWithAttendees, ListEventsFilter, TimeRange } from "./types.js";

function pick<T>(obj: unknown, key: string): T | undefined {
  if (obj && typeof obj === "object") return (obj as Record<string, unknown>)[key] as T;
  return undefined;
}

/** Drop undefined values so we never send `key=undefined` as a query/body field. */
function clean(input: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) out[k] = v;
  return out;
}

export class ApiStore implements CalendarStore {
  readonly mode = "cloud" as const;

  constructor(private readonly client: StorageClient) {}

  private get transport() { return this.client.transport; }

  // ── Orgs ──
  async listOrgs(): Promise<Org[]> {
    const res = await this.client.list<{ orgs?: Org[] }>("orgs");
    return pick<Org[]>(res, "orgs") ?? [];
  }
  async getOrg(idOrSlug: string): Promise<Org | null> {
    const res = await this.client.get<{ org?: Org }>("orgs", idOrSlug);
    return res ? (pick<Org>(res, "org") ?? null) : null;
  }
  async createOrg(input: CreateOrgInput): Promise<Org> {
    const res = await this.client.create<{ org?: Org }>("orgs", clean(input));
    return (pick<Org>(res, "org") ?? (res as Org));
  }
  async updateOrg(id: string, input: UpdateOrgInput): Promise<Org> {
    const res = await this.client.update<{ org?: Org }>("orgs", id, clean(input));
    return (pick<Org>(res, "org") ?? (res as Org));
  }
  async deleteOrg(id: string): Promise<boolean> {
    const res = await this.client.delete<{ deleted?: boolean }>("orgs", id);
    return Boolean(pick<boolean>(res, "deleted") ?? true);
  }

  // ── Agents ──
  async registerAgent(input: RegisterAgentInput): Promise<Agent> {
    const res = await this.client.create<{ agent?: Agent }>("agents", clean(input));
    return (pick<Agent>(res, "agent") ?? (res as Agent));
  }
  async listAgents(): Promise<Agent[]> {
    const res = await this.client.list<{ agents?: Agent[] }>("agents");
    return pick<Agent[]>(res, "agents") ?? [];
  }
  async getAgent(idOrName: string): Promise<Agent | null> {
    const res = await this.client.get<{ agent?: Agent }>("agents", idOrName);
    return res ? (pick<Agent>(res, "agent") ?? null) : null;
  }
  async heartbeatAgent(idOrName: string): Promise<Agent | null> {
    try {
      const res = await this.transport.post<{ agent?: Agent }>(`/agents/${encodeURIComponent(idOrName)}/heartbeat`);
      return pick<Agent>(res, "agent") ?? null;
    } catch (error) {
      if (error instanceof HasnaHttpError && error.status === 404) return null;
      throw error;
    }
  }
  async updateAgent(id: string, updates: Partial<RegisterAgentInput>): Promise<Agent | null> {
    const res = await this.client.update<{ agent?: Agent }>("agents", id, clean(updates));
    return pick<Agent>(res, "agent") ?? (res as Agent) ?? null;
  }
  async deleteAgent(id: string): Promise<boolean> {
    const res = await this.client.delete<{ deleted?: boolean }>("agents", id);
    return Boolean(pick<boolean>(res, "deleted") ?? true);
  }

  // ── Calendars ──
  async listCalendars(orgId?: string): Promise<Calendar[]> {
    const res = await this.client.list<{ calendars?: Calendar[] }>("calendars", orgId ? { query: { org_id: orgId } } : undefined);
    return pick<Calendar[]>(res, "calendars") ?? [];
  }
  async getCalendar(id: string): Promise<Calendar | null> {
    const res = await this.client.get<{ calendar?: Calendar }>("calendars", id);
    return res ? (pick<Calendar>(res, "calendar") ?? null) : null;
  }
  async createCalendar(input: CreateCalendarInput): Promise<Calendar> {
    const res = await this.client.create<{ calendar?: Calendar }>("calendars", clean(input));
    return (pick<Calendar>(res, "calendar") ?? (res as Calendar));
  }
  async updateCalendar(id: string, input: UpdateCalendarInput): Promise<Calendar> {
    const res = await this.client.update<{ calendar?: Calendar }>("calendars", id, clean(input));
    return (pick<Calendar>(res, "calendar") ?? (res as Calendar));
  }
  async deleteCalendar(id: string): Promise<boolean> {
    const res = await this.client.delete<{ deleted?: boolean }>("calendars", id);
    return Boolean(pick<boolean>(res, "deleted") ?? true);
  }

  // ── Events ──
  async listEvents(filter: ListEventsFilter): Promise<Event[]> {
    const res = await this.client.list<{ events?: Event[] }>("events", { query: clean(filter) as QueryParams });
    return pick<Event[]>(res, "events") ?? [];
  }
  async getEvent(id: string): Promise<Event | null> {
    const res = await this.client.get<{ event?: Event }>("events", id);
    return res ? (pick<Event>(res, "event") ?? null) : null;
  }
  async getEventWithAttendees(id: string): Promise<EventWithAttendees | null> {
    const res = await this.client.get<{ event?: Event; attendees?: EventAttendee[] }>("events", id);
    if (!res) return null;
    const event = pick<Event>(res, "event");
    if (!event) return null;
    return { event, attendees: pick<EventAttendee[]>(res, "attendees") ?? [] };
  }
  async createEvent(input: CreateEventInput): Promise<Event> {
    const res = await this.client.create<{ event?: Event }>("events", clean(input));
    return (pick<Event>(res, "event") ?? (res as Event));
  }
  async updateEvent(id: string, input: UpdateEventInput): Promise<Event> {
    const res = await this.client.update<{ event?: Event }>("events", id, clean(input));
    return (pick<Event>(res, "event") ?? (res as Event));
  }
  async deleteEvent(id: string): Promise<boolean> {
    const res = await this.client.delete<{ deleted?: boolean }>("events", id);
    return Boolean(pick<boolean>(res, "deleted") ?? true);
  }
  async searchEvents(query: string, orgId?: string): Promise<Event[]> {
    const res = await this.transport.get<{ events?: Event[] }>("/events/search", { query: clean({ q: query, org_id: orgId }) as QueryParams });
    return pick<Event[]>(res, "events") ?? [];
  }
  async findConflicts(calendarId: string, range: TimeRange): Promise<Event[]> {
    const res = await this.transport.get<{ conflicts?: Event[] }>("/events/conflicts", {
      query: { calendar_id: calendarId, start: range.start, end: range.end },
    });
    return pick<Event[]>(res, "conflicts") ?? [];
  }

  // ── Attendees ──
  async createAttendee(input: CreateAttendeeInput): Promise<EventAttendee> {
    const res = await this.client.create<{ attendee?: EventAttendee }>("attendees", clean(input));
    return (pick<EventAttendee>(res, "attendee") ?? (res as EventAttendee));
  }
  async getAttendeesForEvent(eventId: string): Promise<EventAttendee[]> {
    const res = await this.transport.get<{ attendees?: EventAttendee[] }>("/attendees", { query: { event_id: eventId } });
    return pick<EventAttendee[]>(res, "attendees") ?? [];
  }
  async updateAttendee(id: string, input: UpdateAttendeeInput): Promise<EventAttendee> {
    const res = await this.client.update<{ attendee?: EventAttendee }>("attendees", id, clean(input));
    return (pick<EventAttendee>(res, "attendee") ?? (res as EventAttendee));
  }
  async deleteAttendee(id: string): Promise<boolean> {
    const res = await this.client.delete<{ deleted?: boolean }>("attendees", id);
    return Boolean(pick<boolean>(res, "deleted") ?? true);
  }

  // ── Availability ──
  async getAvailabilityForAgent(agentId: string, orgId?: string): Promise<Availability[]> {
    const res = await this.transport.get<{ availability?: Availability[] }>("/availability", { query: clean({ agent_id: agentId, org_id: orgId }) as QueryParams });
    return pick<Availability[]>(res, "availability") ?? [];
  }
  async upsertAgentAvailability(agentId: string, orgId: string, dayOfWeek: number, startTime: string, endTime: string): Promise<Availability> {
    const res = await this.transport.post<{ availability?: Availability }>("/availability", {
      agent_id: agentId, org_id: orgId, day_of_week: dayOfWeek, start_time: startTime, end_time: endTime,
    });
    return (pick<Availability>(res, "availability") ?? (res as Availability));
  }
  async deleteAvailability(id: string): Promise<boolean> {
    const res = await this.client.delete<{ deleted?: boolean }>("availability", id);
    return Boolean(pick<boolean>(res, "deleted") ?? true);
  }

  // ── Memberships ──
  async createMembership(input: CreateOrgMembershipInput): Promise<OrgMembership> {
    const res = await this.client.create<{ member?: OrgMembership }>("members", clean(input));
    return (pick<OrgMembership>(res, "member") ?? (res as OrgMembership));
  }
  async getMembershipsForOrg(orgId: string): Promise<OrgMembership[]> {
    const res = await this.transport.get<{ members?: OrgMembership[] }>("/members", { query: { org_id: orgId } });
    return pick<OrgMembership[]>(res, "members") ?? [];
  }
  async getOrgsForAgent(agentId: string): Promise<OrgMembership[]> {
    const res = await this.transport.get<{ members?: OrgMembership[] }>("/members", { query: { agent_id: agentId } });
    return pick<OrgMembership[]>(res, "members") ?? [];
  }
  async deleteMembershipByAgentAndOrg(agentId: string, orgId: string): Promise<boolean> {
    const res = await this.transport.del<{ deleted?: boolean }>("/members", undefined, { query: { agent_id: agentId, org_id: orgId } });
    return Boolean(pick<boolean>(res, "deleted") ?? true);
  }
}
