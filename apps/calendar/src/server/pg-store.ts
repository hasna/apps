/**
 * Postgres data layer backing the calendar `/v1` API (Amendment A1 pure-remote).
 *
 * This is a REAL wrapper over the calendar domain schema — the exact same
 * relational model as the local SQLite core (src/db/*), reimplemented against
 * the shared RDS Postgres so the serve process reads/writes the cloud DB
 * directly with NO local sync/cache. There are NO stubs: every method issues
 * parameterised SQL and returns the repo's typed shapes. Time validation reuses
 * the pure `event-time` helpers shared with the local core.
 */
import { assertEventEndsAfterStart, parseEventTimestamp, compareEventInstants } from "../db/event-time.js";
import { ConflictError, NotFoundError } from "../types/index.js";
import type {
  Org, CreateOrgInput, UpdateOrgInput,
  Agent, RegisterAgentInput,
  Calendar, CreateCalendarInput, UpdateCalendarInput,
  Event, CreateEventInput, UpdateEventInput,
  EventAttendee, CreateAttendeeInput, UpdateAttendeeInput,
  Availability,
  OrgMembership, CreateOrgMembershipInput,
} from "../types/index.js";
import type { CalendarCloudQueryClient } from "./cloud-client.js";

function newId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function iso(value: unknown): string {
  if (value == null) return new Date(0).toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function isoOrNull(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function asObject(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return value as Record<string, unknown>;
}

function asArrayOrNull(value: unknown): string[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value as string[];
  if (typeof value === "string") {
    try { const p = JSON.parse(value); return Array.isArray(p) ? p : null; } catch { return null; }
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  return asArrayOrNull(value) ?? [];
}

function isUniqueViolation(e: unknown): boolean {
  const msg = (e as Error)?.message ?? "";
  return /duplicate key value|unique constraint|23505/i.test(msg);
}

// ── Row mappers ──────────────────────────────────────────────────────────────

function rowToOrg(r: Record<string, unknown>): Org {
  return {
    id: r.id as string, name: r.name as string, slug: r.slug as string,
    description: (r.description as string) ?? null, metadata: asObject(r.metadata),
    created_at: iso(r.created_at), updated_at: iso(r.updated_at),
  };
}

function rowToAgent(r: Record<string, unknown>): Agent {
  return {
    id: r.id as string, name: r.name as string, description: (r.description as string) ?? null,
    role: (r.role as string) ?? null, title: (r.title as string) ?? null, level: (r.level as string) ?? null,
    capabilities: asStringArray(r.capabilities), status: (r.status as Agent["status"]) ?? "active",
    metadata: asObject(r.metadata), created_at: iso(r.created_at), last_seen_at: iso(r.last_seen_at),
    session_id: (r.session_id as string) ?? null, working_dir: (r.working_dir as string) ?? null,
    active_org_id: (r.active_org_id as string) ?? null,
  };
}

function rowToCalendar(r: Record<string, unknown>): Calendar {
  return {
    id: r.id as string, org_id: r.org_id as string, owner_id: (r.owner_id as string) ?? null,
    slug: r.slug as string, name: r.name as string, description: (r.description as string) ?? null,
    color: (r.color as string) ?? null, timezone: r.timezone as string,
    visibility: r.visibility as Calendar["visibility"], metadata: asObject(r.metadata),
    created_at: iso(r.created_at), updated_at: iso(r.updated_at),
  };
}

function rowToEvent(r: Record<string, unknown>): Event {
  return {
    id: r.id as string, calendar_id: r.calendar_id as string, org_id: r.org_id as string,
    title: r.title as string, description: (r.description as string) ?? null, location: (r.location as string) ?? null,
    start_at: r.start_at as string, end_at: r.end_at as string, all_day: Boolean(r.all_day),
    timezone: r.timezone as string, status: r.status as Event["status"], busy_type: r.busy_type as Event["busy_type"],
    visibility: r.visibility as Event["visibility"], recurrence_rule: (r.recurrence_rule as string) ?? null,
    recurrence_exception_dates: asArrayOrNull(r.recurrence_exception_dates),
    source_task_id: (r.source_task_id as string) ?? null, created_by: (r.created_by as string) ?? null,
    metadata: asObject(r.metadata), created_at: iso(r.created_at), updated_at: iso(r.updated_at),
  };
}

function rowToAttendee(r: Record<string, unknown>): EventAttendee {
  return {
    id: r.id as string, event_id: r.event_id as string, agent_id: (r.agent_id as string) ?? null,
    display_name: (r.display_name as string) ?? null, email: (r.email as string) ?? null,
    status: r.status as EventAttendee["status"], required: Boolean(r.required),
    response_comment: (r.response_comment as string) ?? null, responded_at: isoOrNull(r.responded_at),
    created_at: iso(r.created_at),
  };
}

function rowToAvailability(r: Record<string, unknown>): Availability {
  return {
    id: r.id as string, agent_id: r.agent_id as string, org_id: r.org_id as string,
    day_of_week: Number(r.day_of_week), start_time: r.start_time as string, end_time: r.end_time as string,
    exceptions: asArrayOrNull(r.exceptions), created_at: iso(r.created_at), updated_at: iso(r.updated_at),
  };
}

function rowToMembership(r: Record<string, unknown>): OrgMembership {
  return {
    id: r.id as string, org_id: r.org_id as string, agent_id: r.agent_id as string,
    role: r.role as OrgMembership["role"], created_at: iso(r.created_at),
  };
}

// ── Store ────────────────────────────────────────────────────────────────────

export interface ListEventsFilter {
  calendar_id?: string;
  org_id?: string;
  status?: string;
  after?: string;
  before?: string;
  created_by?: string;
  source_task_id?: string;
  limit?: number;
  offset?: number;
}

export interface TimeRange { start: string; end: string; }

export class CalendarPgStore {
  constructor(private readonly client: CalendarCloudQueryClient) {}

  private async one<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    const res = await this.client.query<T>(sql, params);
    return res.rows[0] ?? null;
  }
  private async many<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const res = await this.client.query<T>(sql, params);
    return res.rows;
  }

  // ── Orgs ──
  async createOrg(input: CreateOrgInput): Promise<Org> {
    const id = newId();
    const slug = input.slug || slugify(input.name);
    try {
      await this.client.query(
        `INSERT INTO orgs (id, name, slug, description, metadata) VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [id, input.name, slug, input.description ?? null, JSON.stringify(input.metadata ?? {})],
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError(`Org slug "${slug}" already exists`);
      throw e;
    }
    return (await this.getOrg(id))!;
  }
  async getOrg(idOrSlug: string): Promise<Org | null> {
    const r = await this.one("SELECT * FROM orgs WHERE id=$1 OR slug=$1", [idOrSlug]);
    return r ? rowToOrg(r) : null;
  }
  async listOrgs(): Promise<Org[]> {
    return (await this.many("SELECT * FROM orgs ORDER BY name")).map(rowToOrg);
  }
  async updateOrg(id: string, input: UpdateOrgInput): Promise<Org> {
    const existing = await this.getOrg(id);
    if (!existing) throw new NotFoundError("Org", id);
    await this.client.query(
      `UPDATE orgs SET name=$2, description=$3, metadata=$4::jsonb, updated_at=now() WHERE id=$1`,
      [id, input.name ?? existing.name, input.description !== undefined ? input.description : existing.description,
        JSON.stringify(input.metadata ?? existing.metadata)],
    );
    return (await this.getOrg(id))!;
  }
  async deleteOrg(id: string): Promise<boolean> {
    const r = await this.many("DELETE FROM orgs WHERE id=$1 RETURNING id", [id]);
    return r.length > 0;
  }

  // ── Agents ──
  async registerAgent(input: RegisterAgentInput): Promise<Agent> {
    const existing = await this.getAgentByName(input.name);
    if (existing) {
      await this.client.query(
        `UPDATE agents SET description=$2, role=$3, title=$4, level=$5, capabilities=$6::jsonb, metadata=$7::jsonb,
          session_id=$8, working_dir=$9, active_org_id=$10, last_seen_at=now() WHERE id=$1`,
        [existing.id, input.description ?? existing.description, input.role ?? existing.role,
          input.title ?? existing.title, input.level ?? existing.level,
          JSON.stringify(input.capabilities ?? existing.capabilities),
          JSON.stringify(input.metadata ?? existing.metadata), input.session_id ?? existing.session_id,
          input.working_dir ?? existing.working_dir, input.org_id ?? existing.active_org_id],
      );
      return (await this.getAgent(existing.id))!;
    }
    const id = newId();
    await this.client.query(
      `INSERT INTO agents (id, name, description, role, title, level, capabilities, metadata, session_id, working_dir, active_org_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)`,
      [id, input.name, input.description ?? null, input.role ?? null, input.title ?? null, input.level ?? null,
        JSON.stringify(input.capabilities ?? []), JSON.stringify(input.metadata ?? {}),
        input.session_id ?? null, input.working_dir ?? null, input.org_id ?? null],
    );
    return (await this.getAgent(id))!;
  }
  async getAgent(idOrName: string): Promise<Agent | null> {
    const r = await this.one("SELECT * FROM agents WHERE id=$1 OR name=$1", [idOrName]);
    return r ? rowToAgent(r) : null;
  }
  async getAgentByName(name: string): Promise<Agent | null> {
    const r = await this.one("SELECT * FROM agents WHERE name=$1", [name]);
    return r ? rowToAgent(r) : null;
  }
  async listAgents(): Promise<Agent[]> {
    return (await this.many("SELECT * FROM agents ORDER BY name")).map(rowToAgent);
  }
  async heartbeatAgent(id: string): Promise<Agent | null> {
    const r = await this.many("UPDATE agents SET last_seen_at=now() WHERE id=$1 OR name=$1 RETURNING *", [id]);
    return r[0] ? rowToAgent(r[0]) : null;
  }

  // ── Calendars ──
  async createCalendar(input: CreateCalendarInput): Promise<Calendar> {
    const id = newId();
    const slug = input.slug || slugify(input.name);
    try {
      await this.client.query(
        `INSERT INTO calendars (id, org_id, owner_id, slug, name, description, color, timezone, visibility, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [id, input.org_id, input.owner_id ?? null, slug, input.name, input.description ?? null,
          input.color ?? null, input.timezone ?? "UTC", input.visibility ?? "org", JSON.stringify(input.metadata ?? {})],
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError(`Calendar slug "${slug}" already exists in this org`);
      throw e;
    }
    return (await this.getCalendar(id))!;
  }
  async getCalendar(id: string): Promise<Calendar | null> {
    const r = await this.one("SELECT * FROM calendars WHERE id=$1", [id]);
    return r ? rowToCalendar(r) : null;
  }
  async listCalendars(orgId?: string): Promise<Calendar[]> {
    const rows = orgId
      ? await this.many("SELECT * FROM calendars WHERE org_id=$1 ORDER BY name", [orgId])
      : await this.many("SELECT * FROM calendars ORDER BY org_id, name");
    return rows.map(rowToCalendar);
  }
  async updateCalendar(id: string, input: UpdateCalendarInput): Promise<Calendar> {
    const existing = await this.getCalendar(id);
    if (!existing) throw new NotFoundError("Calendar", id);
    await this.client.query(
      `UPDATE calendars SET name=$2, description=$3, color=$4, timezone=$5, visibility=$6, metadata=$7::jsonb, updated_at=now() WHERE id=$1`,
      [id, input.name ?? existing.name, input.description !== undefined ? input.description : existing.description,
        input.color !== undefined ? input.color : existing.color, input.timezone ?? existing.timezone,
        input.visibility ?? existing.visibility, JSON.stringify(input.metadata ?? existing.metadata)],
    );
    return (await this.getCalendar(id))!;
  }
  async deleteCalendar(id: string): Promise<boolean> {
    const r = await this.many("DELETE FROM calendars WHERE id=$1 RETURNING id", [id]);
    return r.length > 0;
  }

  // ── Events ──
  async createEvent(input: CreateEventInput): Promise<Event> {
    assertEventEndsAfterStart(input.start_at, input.end_at);
    const id = newId();
    await this.client.query(
      `INSERT INTO events (id, calendar_id, org_id, title, description, location, start_at, end_at, all_day, timezone,
        status, busy_type, visibility, recurrence_rule, recurrence_exception_dates, source_task_id, created_by, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18::jsonb)`,
      [id, input.calendar_id, input.org_id, input.title, input.description ?? null, input.location ?? null,
        input.start_at, input.end_at, input.all_day ?? false, input.timezone ?? "UTC",
        input.status ?? "confirmed", input.busy_type ?? "busy", input.visibility ?? "default",
        input.recurrence_rule ?? null,
        input.recurrence_exception_dates ? JSON.stringify(input.recurrence_exception_dates) : null,
        input.source_task_id ?? null, input.created_by ?? null, JSON.stringify(input.metadata ?? {})],
    );
    return (await this.getEvent(id))!;
  }
  async getEvent(id: string): Promise<Event | null> {
    const r = await this.one("SELECT * FROM events WHERE id=$1", [id]);
    return r ? rowToEvent(r) : null;
  }
  async listEvents(filter: ListEventsFilter = {}): Promise<Event[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    const push = (c: string, v: unknown) => { params.push(v); conds.push(c.replace("?", `$${params.length}`)); };
    if (filter.calendar_id) push("calendar_id = ?", filter.calendar_id);
    if (filter.org_id) push("org_id = ?", filter.org_id);
    if (filter.status) push("status = ?", filter.status);
    if (filter.created_by) push("created_by = ?", filter.created_by);
    if (filter.source_task_id) push("source_task_id = ?", filter.source_task_id);
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const rows = (await this.many(`SELECT * FROM events ${where}`, params)).map(rowToEvent);
    const after = filter.after ? parseEventTimestamp(filter.after) : null;
    const before = filter.before ? parseEventTimestamp(filter.before) : null;
    const filtered = rows
      .map((event) => ({ event, start: parseEventTimestamp(event.start_at) }))
      .filter(({ start }) => (after === null || start >= after) && (before === null || start <= before))
      .sort((a, b) => compareEventInstants(a.start, b.start) || a.event.start_at.localeCompare(b.event.start_at))
      .map(({ event }) => event);
    const offset = filter.offset && filter.offset > 0 ? filter.offset : 0;
    const limit = filter.limit && filter.limit > 0 ? filter.limit : undefined;
    return limit ? filtered.slice(offset, offset + limit) : filtered.slice(offset);
  }
  async updateEvent(id: string, input: UpdateEventInput): Promise<Event> {
    const existing = await this.getEvent(id);
    if (!existing) throw new NotFoundError("Event", id);
    const startAt = input.start_at ?? existing.start_at;
    const endAt = input.end_at ?? existing.end_at;
    assertEventEndsAfterStart(startAt, endAt);
    const excDates = input.recurrence_exception_dates !== undefined
      ? (input.recurrence_exception_dates ? JSON.stringify(input.recurrence_exception_dates) : null)
      : (existing.recurrence_exception_dates ? JSON.stringify(existing.recurrence_exception_dates) : null);
    await this.client.query(
      `UPDATE events SET title=$2, description=$3, location=$4, start_at=$5, end_at=$6, all_day=$7, timezone=$8,
        status=$9, busy_type=$10, visibility=$11, recurrence_rule=$12, recurrence_exception_dates=$13::jsonb,
        source_task_id=$14, metadata=$15::jsonb, updated_at=now() WHERE id=$1`,
      [id, input.title ?? existing.title, input.description !== undefined ? input.description : existing.description,
        input.location !== undefined ? input.location : existing.location, startAt, endAt,
        input.all_day !== undefined ? input.all_day : existing.all_day, input.timezone ?? existing.timezone,
        input.status ?? existing.status, input.busy_type ?? existing.busy_type, input.visibility ?? existing.visibility,
        input.recurrence_rule !== undefined ? input.recurrence_rule : existing.recurrence_rule, excDates,
        input.source_task_id !== undefined ? input.source_task_id : existing.source_task_id,
        JSON.stringify(input.metadata ?? existing.metadata)],
    );
    return (await this.getEvent(id))!;
  }
  async deleteEvent(id: string): Promise<boolean> {
    const r = await this.many("DELETE FROM events WHERE id=$1 RETURNING id", [id]);
    return r.length > 0;
  }
  async findConflicts(calendarId: string, range: TimeRange, excludeEventId?: string): Promise<Event[]> {
    const { start: rStart, end: rEnd } = { start: parseEventTimestamp(range.start), end: parseEventTimestamp(range.end) };
    if (rEnd <= rStart) throw new RangeError("Time range end must be after start");
    const rows = excludeEventId
      ? await this.many("SELECT * FROM events WHERE calendar_id=$1 AND status!='cancelled' AND id!=$2", [calendarId, excludeEventId])
      : await this.many("SELECT * FROM events WHERE calendar_id=$1 AND status!='cancelled'", [calendarId]);
    return rows.map(rowToEvent)
      .map((event) => ({ event, start: parseEventTimestamp(event.start_at), end: parseEventTimestamp(event.end_at) }))
      .filter(({ start, end }) => start < rEnd && end > rStart)
      .sort((a, b) => compareEventInstants(a.start, b.start) || a.event.start_at.localeCompare(b.event.start_at))
      .map(({ event }) => event);
  }
  async searchEvents(query: string, orgId?: string): Promise<Event[]> {
    const like = `%${query}%`;
    const rows = orgId
      ? await this.many(
          `SELECT * FROM events WHERE org_id=$2 AND (title ILIKE $1 OR description ILIKE $1 OR location ILIKE $1)`,
          [like, orgId])
      : await this.many(
          `SELECT * FROM events WHERE title ILIKE $1 OR description ILIKE $1 OR location ILIKE $1`, [like]);
    return rows.map(rowToEvent)
      .sort((a, b) => compareEventInstants(parseEventTimestamp(a.start_at), parseEventTimestamp(b.start_at)) || a.start_at.localeCompare(b.start_at));
  }

  // ── Attendees ──
  async createAttendee(input: CreateAttendeeInput): Promise<EventAttendee> {
    const id = newId();
    await this.client.query(
      `INSERT INTO event_attendees (id, event_id, agent_id, display_name, email, status, required)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, input.event_id, input.agent_id ?? null, input.display_name ?? null, input.email ?? null,
        input.status ?? "needsAction", input.required !== undefined ? input.required : true],
    );
    return (await this.getAttendee(id))!;
  }
  async getAttendee(id: string): Promise<EventAttendee | null> {
    const r = await this.one("SELECT * FROM event_attendees WHERE id=$1", [id]);
    return r ? rowToAttendee(r) : null;
  }
  async getAttendeesForEvent(eventId: string): Promise<EventAttendee[]> {
    return (await this.many(
      "SELECT * FROM event_attendees WHERE event_id=$1 ORDER BY required DESC, created_at", [eventId])).map(rowToAttendee);
  }
  async updateAttendee(id: string, input: UpdateAttendeeInput): Promise<EventAttendee> {
    const existing = await this.getAttendee(id);
    if (!existing) throw new NotFoundError("EventAttendee", id);
    const newStatus = input.status ?? existing.status;
    await this.client.query(
      `UPDATE event_attendees SET status=$2, response_comment=$3, required=$4,
        responded_at = CASE WHEN $2 IS NOT NULL AND responded_at IS NULL THEN now() ELSE responded_at END WHERE id=$1`,
      [id, newStatus, input.response_comment !== undefined ? input.response_comment : existing.response_comment,
        input.required !== undefined ? input.required : existing.required],
    );
    return (await this.getAttendee(id))!;
  }

  // ── Availability ──
  async getAvailabilityForAgent(agentId: string, orgId?: string): Promise<Availability[]> {
    const rows = orgId
      ? await this.many("SELECT * FROM availability WHERE agent_id=$1 AND org_id=$2 ORDER BY day_of_week", [agentId, orgId])
      : await this.many("SELECT * FROM availability WHERE agent_id=$1 ORDER BY day_of_week", [agentId]);
    return rows.map(rowToAvailability);
  }
  async upsertAgentAvailability(agentId: string, orgId: string, dayOfWeek: number, startTime: string, endTime: string): Promise<Availability> {
    const existing = await this.one(
      "SELECT * FROM availability WHERE agent_id=$1 AND org_id=$2 AND day_of_week=$3", [agentId, orgId, dayOfWeek]);
    if (existing) {
      await this.client.query(
        "UPDATE availability SET start_time=$2, end_time=$3, updated_at=now() WHERE id=$1",
        [existing.id, startTime, endTime]);
      return rowToAvailability((await this.one("SELECT * FROM availability WHERE id=$1", [existing.id]))!);
    }
    const id = newId();
    await this.client.query(
      `INSERT INTO availability (id, agent_id, org_id, day_of_week, start_time, end_time) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, agentId, orgId, dayOfWeek, startTime, endTime]);
    return rowToAvailability((await this.one("SELECT * FROM availability WHERE id=$1", [id]))!);
  }

  // ── Memberships ──
  async createMembership(input: CreateOrgMembershipInput): Promise<OrgMembership> {
    const id = newId();
    try {
      await this.client.query(
        `INSERT INTO org_memberships (id, org_id, agent_id, role) VALUES ($1,$2,$3,$4)`,
        [id, input.org_id, input.agent_id, input.role ?? "member"]);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError("Agent is already a member of this org");
      throw e;
    }
    return rowToMembership((await this.one("SELECT * FROM org_memberships WHERE id=$1", [id]))!);
  }
  async getMembershipsForOrg(orgId: string): Promise<OrgMembership[]> {
    return (await this.many("SELECT * FROM org_memberships WHERE org_id=$1 ORDER BY created_at", [orgId])).map(rowToMembership);
  }
}
