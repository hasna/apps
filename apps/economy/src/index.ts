// @hasna/economy — public library API
//
// The public surface is the Store abstraction plus the shared domain types.
// Every SDK consumer reads and writes economy DATA through `getStore()`, which
// returns an `EconomyStore` bound to the local SQLite (LocalStore) or the cloud
// HTTP API (ApiStore) based on the client-flip env — the SAME one interface the
// CLI and MCP use. The raw on-box SQLite layer (db/database.js) and the local
// ingest/sync/gatherer internals are NOT public API; exposing them was the
// split-brain bug (SDK callers bypassing the Store) this rebuild eliminates.
export * from './types/index.js'
export * from './lib/store/index.js'
