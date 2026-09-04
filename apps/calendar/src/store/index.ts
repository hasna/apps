import { resolveStorageClient, type Env } from "./http-storage.js";
import type { CalendarStore } from "./types.js";
import { ApiStore } from "./api.js";

const APP_SLUG = "calendar";



/** Resolve a new store bound to validated HTTPS authority and credentials. */
export function getStore(env: Env = process.env): CalendarStore {
  const resolved = resolveStorageClient(APP_SLUG, env);
  return new ApiStore(resolved.client);
}

/** Test hook: drop the memoized store so a new env can be resolved. */
export function resetStoreCache(): void {
  // Compatibility hook: no process-global store cache remains.
}

export type { CalendarStore, EventWithAttendees, ListEventsFilter, TimeRange } from "./types.js";
export { ApiStore } from "./api.js";
