// PersonalNotes sync module: API client (one dialect, hosted or self-hosted),
// the engine that maps the canonical local markdown store to /api/v1/sync
// batches, and the scheduling layer (daemon mode, locks, status, service
// install). See docs/sync.md for the protocol mapping and conflict policy.
export * from './client.mjs';
export * from './engine.mjs';
export * from './daemon.mjs';
