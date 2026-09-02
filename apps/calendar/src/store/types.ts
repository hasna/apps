// Calendar domain interface. Public clients use authenticated HTTPS only.
// LocalStore remains an internal test fixture, never selected by getStore().

import type {
  Org, CreateOrgInput, UpdateOrgInput,
  Agent, RegisterAgentInput,
  Calendar, CreateCalendarInput, UpdateCalendarInput,
  Event, CreateEventInput, UpdateEventInput,
  EventAttendee, CreateAttendeeInput, UpdateAttendeeInput,
  Availability,
  OrgMembership, CreateOrgMembershipInput,
} from "../types/index.js";
import type { ListEventsFilter, TimeRange } from "../db/events.js";

export type { ListEventsFilter, TimeRange };

export interface EventWithAttendees {
  event: Event;
  attendees: EventAttendee[];
}

/** The one storage surface shared by LocalStore and ApiStore. */
export interface CalendarStore {
  /** Which transport backs this store (for diagnostics only). */
  readonly transport: "local" | "api";

  // ── Orgs ──
  listOrgs(): Promise<Org[]>;
  getOrg(idOrSlug: string): Promise<Org | null>;
  createOrg(input: CreateOrgInput): Promise<Org>;
  updateOrg(id: string, input: UpdateOrgInput): Promise<Org>;
  deleteOrg(id: string): Promise<boolean>;

  // ── Agents ──
  registerAgent(input: RegisterAgentInput): Promise<Agent>;
  listAgents(): Promise<Agent[]>;
  getAgent(idOrName: string): Promise<Agent | null>;
  heartbeatAgent(idOrName: string): Promise<Agent | null>;
  updateAgent(id: string, updates: Partial<RegisterAgentInput>): Promise<Agent | null>;
  deleteAgent(id: string): Promise<boolean>;

  // ── Calendars ──
  listCalendars(orgId?: string): Promise<Calendar[]>;
  getCalendar(id: string): Promise<Calendar | null>;
  createCalendar(input: CreateCalendarInput): Promise<Calendar>;
  updateCalendar(id: string, input: UpdateCalendarInput): Promise<Calendar>;
  deleteCalendar(id: string): Promise<boolean>;

  // ── Events ──
  listEvents(filter: ListEventsFilter): Promise<Event[]>;
  getEvent(id: string): Promise<Event | null>;
  getEventWithAttendees(id: string): Promise<EventWithAttendees | null>;
  createEvent(input: CreateEventInput): Promise<Event>;
  updateEvent(id: string, input: UpdateEventInput): Promise<Event>;
  deleteEvent(id: string): Promise<boolean>;
  searchEvents(query: string, orgId?: string): Promise<Event[]>;
  findConflicts(calendarId: string, range: TimeRange): Promise<Event[]>;

  // ── Attendees ──
  createAttendee(input: CreateAttendeeInput): Promise<EventAttendee>;
  getAttendeesForEvent(eventId: string): Promise<EventAttendee[]>;
  updateAttendee(id: string, input: UpdateAttendeeInput): Promise<EventAttendee>;
  deleteAttendee(id: string): Promise<boolean>;

  // ── Availability ──
  getAvailabilityForAgent(agentId: string, orgId?: string): Promise<Availability[]>;
  upsertAgentAvailability(agentId: string, orgId: string, dayOfWeek: number, startTime: string, endTime: string): Promise<Availability>;
  deleteAvailability(id: string): Promise<boolean>;

  // ── Memberships ──
  createMembership(input: CreateOrgMembershipInput): Promise<OrgMembership>;
  getMembershipsForOrg(orgId: string): Promise<OrgMembership[]>;
  getOrgsForAgent(agentId: string): Promise<OrgMembership[]>;
  deleteMembershipByAgentAndOrg(agentId: string, orgId: string): Promise<boolean>;
}
