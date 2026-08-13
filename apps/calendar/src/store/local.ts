// LocalStore — the on-box SQLite transport for `CalendarStore`.
//
// This is the ONLY place in the CLI/MCP call graph allowed to touch the local
// db layer (src/db/*). It adapts the synchronous db functions to the async
// `CalendarStore` surface so callers are transport-agnostic.

import {
  createOrg, getOrg, getOrgBySlug, listOrgs, updateOrg, deleteOrg,
} from "../db/orgs.js";
import {
  registerAgent, getAgent, getAgentByName, listAgents, heartbeat, updateAgent, deleteAgent,
} from "../db/agents.js";
import {
  createCalendar, getCalendar, listCalendars, updateCalendar, deleteCalendar,
} from "../db/calendars.js";
import {
  createEvent, getEvent, listEvents, updateEvent, deleteEvent, findConflicts, searchEvents,
} from "../db/events.js";
import {
  createAttendee, getAttendeesForEvent, updateAttendee, deleteAttendee,
} from "../db/attendees.js";
import {
  getAvailabilityForAgent, upsertAgentAvailability, deleteAvailability,
} from "../db/availability.js";
import {
  createMembership, getMembershipsForOrg, getOrgsForAgent, deleteMembershipByAgentAndOrg,
} from "../db/memberships.js";
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

export class LocalStore implements CalendarStore {
  readonly mode = "local" as const;

  // ── Orgs ──
  async listOrgs(): Promise<Org[]> { return listOrgs(); }
  async getOrg(idOrSlug: string): Promise<Org | null> { return getOrg(idOrSlug) ?? getOrgBySlug(idOrSlug); }
  async createOrg(input: CreateOrgInput): Promise<Org> { return createOrg(input); }
  async updateOrg(id: string, input: UpdateOrgInput): Promise<Org> { return updateOrg(id, input); }
  async deleteOrg(id: string): Promise<boolean> { return deleteOrg(id); }

  // ── Agents ──
  async registerAgent(input: RegisterAgentInput): Promise<Agent> { return registerAgent(input); }
  async listAgents(): Promise<Agent[]> { return listAgents(); }
  async getAgent(idOrName: string): Promise<Agent | null> { return getAgent(idOrName) ?? getAgentByName(idOrName); }
  async heartbeatAgent(idOrName: string): Promise<Agent | null> {
    const agent = getAgent(idOrName) ?? getAgentByName(idOrName);
    if (!agent) return null;
    return heartbeat(agent.id);
  }
  async updateAgent(id: string, updates: Partial<RegisterAgentInput>): Promise<Agent | null> { return updateAgent(id, updates); }
  async deleteAgent(id: string): Promise<boolean> { return deleteAgent(id); }

  // ── Calendars ──
  async listCalendars(orgId?: string): Promise<Calendar[]> { return listCalendars(orgId); }
  async getCalendar(id: string): Promise<Calendar | null> { return getCalendar(id); }
  async createCalendar(input: CreateCalendarInput): Promise<Calendar> { return createCalendar(input); }
  async updateCalendar(id: string, input: UpdateCalendarInput): Promise<Calendar> { return updateCalendar(id, input); }
  async deleteCalendar(id: string): Promise<boolean> { return deleteCalendar(id); }

  // ── Events ──
  async listEvents(filter: ListEventsFilter): Promise<Event[]> { return listEvents(filter); }
  async getEvent(id: string): Promise<Event | null> { return getEvent(id); }
  async getEventWithAttendees(id: string): Promise<EventWithAttendees | null> {
    const event = getEvent(id);
    if (!event) return null;
    return { event, attendees: getAttendeesForEvent(id) };
  }
  async createEvent(input: CreateEventInput): Promise<Event> { return createEvent(input); }
  async updateEvent(id: string, input: UpdateEventInput): Promise<Event> { return updateEvent(id, input); }
  async deleteEvent(id: string): Promise<boolean> { return deleteEvent(id); }
  async searchEvents(query: string, orgId?: string): Promise<Event[]> { return searchEvents(query, orgId); }
  async findConflicts(calendarId: string, range: TimeRange): Promise<Event[]> { return findConflicts(calendarId, range); }

  // ── Attendees ──
  async createAttendee(input: CreateAttendeeInput): Promise<EventAttendee> { return createAttendee(input); }
  async getAttendeesForEvent(eventId: string): Promise<EventAttendee[]> { return getAttendeesForEvent(eventId); }
  async updateAttendee(id: string, input: UpdateAttendeeInput): Promise<EventAttendee> { return updateAttendee(id, input); }
  async deleteAttendee(id: string): Promise<boolean> { return deleteAttendee(id); }

  // ── Availability ──
  async getAvailabilityForAgent(agentId: string, orgId?: string): Promise<Availability[]> { return getAvailabilityForAgent(agentId, orgId); }
  async upsertAgentAvailability(agentId: string, orgId: string, dayOfWeek: number, startTime: string, endTime: string): Promise<Availability> {
    return upsertAgentAvailability(agentId, orgId, dayOfWeek, startTime, endTime);
  }
  async deleteAvailability(id: string): Promise<boolean> { return deleteAvailability(id); }

  // ── Memberships ──
  async createMembership(input: CreateOrgMembershipInput): Promise<OrgMembership> { return createMembership(input); }
  async getMembershipsForOrg(orgId: string): Promise<OrgMembership[]> { return getMembershipsForOrg(orgId); }
  async getOrgsForAgent(agentId: string): Promise<OrgMembership[]> { return getOrgsForAgent(agentId); }
  async deleteMembershipByAgentAndOrg(agentId: string, orgId: string): Promise<boolean> { return deleteMembershipByAgentAndOrg(agentId, orgId); }
}
