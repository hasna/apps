// The storage resolver for @hasna/calendar.
//
// `getStore()` reads the client-flip env (HASNA_CALENDAR_API_URL +
// HASNA_CALENDAR_API_KEY and/or HASNA_CALENDAR_STORAGE_MODE) exactly once and
// returns the right transport:
//   - ApiStore   when the client resolves to cloud-http (self_hosted / cloud).
//   - LocalStore otherwise (first-class local mode).
//
// It throws if cloud was requested but is misconfigured (URL/key missing or
// invalid) so a caller never silently reads the wrong dataset. Unsetting the
// env reverts to local — the flip is fully reversible.

import { resolveStorageClient, type Env } from "./http-storage.js";
import type { CalendarStore } from "./types.js";
import { LocalStore } from "./local.js";
import { ApiStore } from "./api.js";

const APP_SLUG = "calendar";

let cached: CalendarStore | undefined;

/** Resolve the calendar store for the current env. Memoized per process. */
export function getStore(env: Env = process.env): CalendarStore {
  if (cached) return cached;
  const resolved = resolveStorageClient(APP_SLUG, env);
  cached = resolved.transport === "cloud-http" ? new ApiStore(resolved.client) : new LocalStore();
  return cached;
}

/** Test hook: drop the memoized store so a new env can be resolved. */
export function resetStoreCache(): void {
  cached = undefined;
}

export type { CalendarStore, EventWithAttendees, ListEventsFilter, TimeRange } from "./types.js";
export { LocalStore } from "./local.js";
export { ApiStore } from "./api.js";
