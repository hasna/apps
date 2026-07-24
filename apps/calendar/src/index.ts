// Shared domain types (no runtime storage surface).
export * from "./types/index.js";

// Storage abstraction (LocalStore + ApiStore behind one interface). This is the
// ONLY data-access surface the package exposes: every SDK call routes through the
// Store, so nothing outside the Store impls can touch sqlite directly.
export { getStore, resetStoreCache, LocalStore, ApiStore } from "./store/index.js";
export type { CalendarStore, EventWithAttendees, ListEventsFilter, TimeRange } from "./store/index.js";
