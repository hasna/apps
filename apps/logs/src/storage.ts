/**
 * @hasna/logs — public storage entrypoint (`@hasna/logs/storage`).
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * The unified data-plane Store abstraction: LocalStore (on-box SQLite) and
 * ApiStore (HTTP /v1 + bearer key) behind ONE interface, resolved from the
 * environment. Every CLI command and MCP tool routes log reads/writes through
 * this. The HTTP transport always uses ApiStore (identical client code;
 * only URL/key differ). There is NO DSN-on-client path: the raw RDS DSN is
 * never distributed to machines (CLAUDE.md §2).
 */
export { STORAGE_TABLES, LOGS_STORAGE_TABLES } from "./lib/storage-tables.ts";
export { PG_MIGRATIONS } from "./db/pg-migrations.ts";

export {
  ApiStore,
  usesHttpTransport,
  LocalStore,
  localStoreIfAvailable,
  LOGS_APP_SLUG,
  requireLocalStore,
  resolveStore,
  type Store,
} from "./store/index.ts";
