// Calendar cloud store facade.
//
// Resolves the self_hosted (cloud-http) client for the "calendar" app and
// exposes org/calendar/event CRUD that mirrors the local db.* functions but
// routes every read and write to https://calendar.hasna.xyz/v1 (or the
// configured HASNA_CALENDAR_API_URL). Response envelopes from the /v1 API
// ({ org }, { orgs }, { calendar }, { event }, { deleted }) are unwrapped here so
// CLI/SDK callers get the same shapes they get from the local store.
//
// getCalendarCloud() returns null when the app is in local mode, so callers use
// the pattern:
//   const cloud = getCalendarCloud();
//   if (cloud) { ...await cloud.listEvents()... } else { ...listEvents()... }

import { resolveStorageClient, type StorageClient, type QueryParams } from "./http-storage.js";

export interface CalendarCloudStore {
  readonly client: StorageClient;
  // orgs
  listOrgs(): Promise<unknown[]>;
  getOrg(id: string): Promise<unknown | null>;
  createOrg(input: Record<string, unknown>): Promise<unknown>;
  updateOrg(id: string, input: Record<string, unknown>): Promise<unknown>;
  deleteOrg(id: string): Promise<boolean>;
  // calendars
  listCalendars(orgId?: string): Promise<unknown[]>;
  getCalendar(id: string): Promise<unknown | null>;
  createCalendar(input: Record<string, unknown>): Promise<unknown>;
  updateCalendar(id: string, input: Record<string, unknown>): Promise<unknown>;
  deleteCalendar(id: string): Promise<boolean>;
  // events
  listEvents(filter: Record<string, unknown>): Promise<unknown[]>;
  getEvent(id: string): Promise<unknown | null>;
  getEventWithAttendees(id: string): Promise<{ event: unknown; attendees: unknown[] } | null>;
  createEvent(input: Record<string, unknown>): Promise<unknown>;
  updateEvent(id: string, input: Record<string, unknown>): Promise<unknown>;
  deleteEvent(id: string): Promise<boolean>;
}

function pick<T = unknown>(obj: unknown, key: string): T | undefined {
  if (obj && typeof obj === "object") return (obj as Record<string, unknown>)[key] as T;
  return undefined;
}

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) out[k] = v;
  return out;
}

let cached: CalendarCloudStore | null | undefined;

/** Resolve the calendar cloud store, or null when in local mode. Memoized. */
export function getCalendarCloud(env: Record<string, string | undefined> = process.env): CalendarCloudStore | null {
  if (cached !== undefined) return cached;
  const resolved = resolveStorageClient("calendar", env);
  if (resolved.transport !== "cloud-http") {
    cached = null;
    return cached;
  }
  const client = resolved.client;
  cached = {
    client,
    async listOrgs() {
      const res = await client.list<{ orgs?: unknown[] }>("orgs");
      return pick<unknown[]>(res, "orgs") ?? [];
    },
    async getOrg(id) {
      const res = await client.get<{ org?: unknown }>("orgs", id);
      return res ? (pick(res, "org") ?? null) : null;
    },
    async createOrg(input) {
      const res = await client.create<{ org?: unknown }>("orgs", stripUndefined(input));
      return pick(res, "org") ?? res;
    },
    async updateOrg(id, input) {
      const res = await client.update<{ org?: unknown }>("orgs", id, stripUndefined(input));
      return pick(res, "org") ?? res;
    },
    async deleteOrg(id) {
      const res = await client.delete<{ deleted?: boolean }>("orgs", id);
      return Boolean(pick(res, "deleted") ?? true);
    },
    async listCalendars(orgId) {
      const res = await client.list<{ calendars?: unknown[] }>("calendars", orgId ? { query: { org_id: orgId } } : undefined);
      return pick<unknown[]>(res, "calendars") ?? [];
    },
    async getCalendar(id) {
      const res = await client.get<{ calendar?: unknown }>("calendars", id);
      return res ? (pick(res, "calendar") ?? null) : null;
    },
    async createCalendar(input) {
      const res = await client.create<{ calendar?: unknown }>("calendars", stripUndefined(input));
      return pick(res, "calendar") ?? res;
    },
    async updateCalendar(id, input) {
      const res = await client.update<{ calendar?: unknown }>("calendars", id, stripUndefined(input));
      return pick(res, "calendar") ?? res;
    },
    async deleteCalendar(id) {
      const res = await client.delete<{ deleted?: boolean }>("calendars", id);
      return Boolean(pick(res, "deleted") ?? true);
    },
    async listEvents(filter) {
      const res = await client.list<{ events?: unknown[] }>("events", { query: stripUndefined(filter) as QueryParams });
      return pick<unknown[]>(res, "events") ?? [];
    },
    async getEvent(id) {
      const res = await client.get<{ event?: unknown }>("events", id);
      return res ? (pick(res, "event") ?? null) : null;
    },
    async getEventWithAttendees(id) {
      const res = await client.get<{ event?: unknown; attendees?: unknown[] }>("events", id);
      if (!res) return null;
      const event = pick(res, "event");
      if (!event) return null;
      return { event, attendees: pick<unknown[]>(res, "attendees") ?? [] };
    },
    async createEvent(input) {
      const res = await client.create<{ event?: unknown }>("events", stripUndefined(input));
      return pick(res, "event") ?? res;
    },
    async updateEvent(id, input) {
      const res = await client.update<{ event?: unknown }>("events", id, stripUndefined(input));
      return pick(res, "event") ?? res;
    },
    async deleteEvent(id) {
      const res = await client.delete<{ deleted?: boolean }>("events", id);
      return Boolean(pick(res, "deleted") ?? true);
    },
  };
  return cached;
}

/** Test hook: reset the memoized store so a new env can be resolved. */
export function resetCalendarCloudCache(): void {
  cached = undefined;
}
