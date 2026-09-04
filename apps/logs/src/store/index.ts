/**
 * @hasna/logs — Store resolver.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * ONE entry point that resolves the live {@link Store} from the environment:
 *
 *   HASNA_LOGS_API_URL + an API credential  => ApiStore  (HTTP /v1)
 *   otherwise                                => LocalStore (on-box SQLite)
 *
 * Callers (CLI, MCP, SDK) call {@link resolveStore} once and hold the interface;
 * they never branch on transport and never touch `getDb()` / raw `fetch`
 * directly. The flip is the @hasna/contracts client transport contract: an API
 * URL with a credential selects HTTP; otherwise the store is local SQLite.
 */
import { resolveStorageClient } from "@hasna/contracts/client/storage";
import { ApiStore } from "./api.ts";
import { LocalStore } from "./local.ts";
import type { Store } from "./types.ts";

export type { Store } from "./types.ts";
export { LocalStore } from "./local.ts";
export { ApiStore } from "./api.ts";

/** App slug used for the client-flip env keys (HASNA_LOGS_*). */
export const LOGS_APP_SLUG = "logs";

/**
 * Resolve the live {@link Store} from the environment. Returns an
 * {@link ApiStore} when the client transport resolves to HTTP (API_URL +
 * credential present), else a {@link LocalStore}.
 */
export function resolveStore(env: NodeJS.ProcessEnv = process.env): Store {
  const resolved = resolveStorageClient(LOGS_APP_SLUG, env);
  if (resolved.transport === "http") {
    return new ApiStore(resolved.client);
  }
  return new LocalStore();
}

/** True when the environment resolves to the HTTP transport. */
export function usesHttpTransport(env: NodeJS.ProcessEnv = process.env): boolean {
  const resolved = resolveStorageClient(LOGS_APP_SLUG, env);
  return resolved.transport === "http";
}

/**
 * Return the concrete {@link LocalStore} for on-box maintenance operations
 * whose SUBJECT exists only on the local backend, throwing loudly in HTTP mode
 * instead of silently touching a stale local db. Fully reversible: unset the
 * API vars.
 *
 * STRONG REASON (recorded 2026-08-18 for the local-only-capability review;
 * reviewer rules on it): the operations behind this guard — `db doctor
 * segments`, `db doctor rebuild-index`, `db doctor repair-segments` — verify,
 * rebuild and repair the raw event store: on-disk JSONL segment files plus
 * manifests and hashes (`src/lib/event-store.ts` reads those files directly).
 * The hosted tier deliberately does NOT persist raw envelopes: the cloud
 * `event_records` rows carry redacted metadata plus a content hash with
 * `segment_id`/`segment_path` placeholders and `raw: null` by design
 * (`src/server/cloud/store.ts`). There is therefore no hosted subject for
 * these operations — no raw segments to verify, no SQLite projections to
 * rebuild from them, no segment lines to quarantine. Porting would mean
 * re-architecting the hosted tier to store raw envelopes (a product change
 * against a documented design choice), not porting this capability; a
 * Postgres integrity check would be a NEW capability, not this one.
 */
export function requireLocalStore(
  operation: string,
  env: NodeJS.ProcessEnv = process.env,
): LocalStore {
  if (usesHttpTransport(env)) {
    throw new Error(
      `'${operation}' is a local-only operation and cannot run on the HTTP transport (the cloud tier is a shared log sink). Unset HASNA_LOGS_API_URL/HASNA_LOGS_API_KEY to run it against the local store.`,
    );
  }
  return new LocalStore();
}

/**
 * Best-effort {@link LocalStore} for internal self-telemetry: returns a store
 * when local, or `null` on the HTTP transport (where the events catalog has no
 * home). Callers must treat telemetry as optional and never let it change
 * behavior.
 */
export function localStoreIfAvailable(
  env: NodeJS.ProcessEnv = process.env,
): LocalStore | null {
  return usesHttpTransport(env) ? null : new LocalStore();
}
