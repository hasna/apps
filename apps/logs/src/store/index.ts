/**
 * @hasna/logs — Store resolver.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * ONE entry point that resolves the live {@link Store} from the environment:
 *
 *   HASNA_LOGS_API_URL + HASNA_LOGS_API_KEY  => ApiStore  (HTTP /v1)
 *   HASNA_LOGS_LOCAL=1 (explicit opt-in)     => LocalStore (on-box SQLite)
 *   otherwise                                => FAIL CLOSED (actionable error)
 *
 * Callers (CLI, MCP, SDK) call {@link resolveStore} once and hold the interface;
 * they never branch on transport and never touch `getDb()` / raw `fetch`
 * directly. The flip is the @hasna/contracts client transport contract: an API
 * URL with a credential selects HTTP. Owner ruling (2026-09-04, fail-closed
 * campaign): running WITHOUT the fleet API env must NEVER silently fall back to
 * the local SQLite store (~/.hasna/logs/logs.db) — local mode is reachable only
 * through the explicit opt-in HASNA_LOGS_LOCAL=1 (alias LOGS_LOCAL=1).
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

/** Env vars that opt in to the local SQLite store explicitly. */
const LOCAL_OPT_IN_ENVS = ["HASNA_LOGS_LOCAL", "LOGS_LOCAL"] as const;

const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * True only when the caller explicitly opted into the local SQLite store.
 * A defined-but-blank or false value is never an opt-in.
 */
function hasExplicitLocalOptIn(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return LOCAL_OPT_IN_ENVS.some((name) =>
    TRUE_ENV_VALUES.has(env[name]?.trim().toLowerCase() ?? ""),
  );
}

function failClosedError(): Error {
  return new Error(
    "@hasna/logs requires the fleet API: set HASNA_LOGS_API_URL and HASNA_LOGS_API_KEY (aliases LOGS_API_URL/LOGS_API_KEY). " +
      "Refusing to silently serve the local store (~/.hasna/logs/logs.db); to run in explicit local mode, set HASNA_LOGS_LOCAL=1 (alias LOGS_LOCAL).",
  );
}

/**
 * Resolve the live {@link Store} from the environment. Returns an
 * {@link ApiStore} when the client transport resolves to HTTP (API_URL +
 * credential present), a {@link LocalStore} when the caller explicitly opted
 * in with HASNA_LOGS_LOCAL=1, and otherwise FAILS CLOSED: no silent local
 * fallback when the fleet API env is missing.
 */
export function resolveStore(env: NodeJS.ProcessEnv = process.env): Store {
  const resolved = resolveStorageClient(LOGS_APP_SLUG, env);
  if (resolved.transport === "http") {
    return new ApiStore(resolved.client);
  }
  if (hasExplicitLocalOptIn(env)) {
    return new LocalStore();
  }
  throw failClosedError();
}

/** True when the environment resolves to the HTTP transport. */
export function usesHttpTransport(env: NodeJS.ProcessEnv = process.env): boolean {
  const resolved = resolveStorageClient(LOGS_APP_SLUG, env);
  return resolved.transport === "http";
}

/**
 * Return the concrete {@link LocalStore} for on-box maintenance operations
 * whose SUBJECT exists only on the local backend, throwing loudly in HTTP mode
 * instead of silently touching a stale local db. Local mode here, like every
 * local access, requires the explicit opt-in (HASNA_LOGS_LOCAL=1); otherwise
 * the operation fails closed. Reversible: unset the API vars and set
 * HASNA_LOGS_LOCAL=1.
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
      `'${operation}' is a local-only operation and cannot run on the HTTP transport (the cloud tier is a shared log sink). Unset HASNA_LOGS_API_URL/HASNA_LOGS_API_KEY and set HASNA_LOGS_LOCAL=1 to run it against the local store.`,
    );
  }
  if (!hasExplicitLocalOptIn(env)) {
    throw new Error(
      `'${operation}' is a local-only operation and the local store is not the default. Run it in explicit local mode: set HASNA_LOGS_LOCAL=1 (alias LOGS_LOCAL).`,
    );
  }
  return new LocalStore();
}

/**
 * Best-effort {@link LocalStore} for internal self-telemetry: returns a store
 * only in explicit local mode (HASNA_LOGS_LOCAL=1), or `null` on the HTTP
 * transport AND when no explicit opt-in is present (where the events catalog
 * has no home and a local file must never be opened silently). Callers must
 * treat telemetry as optional and never let it change behavior.
 */
export function localStoreIfAvailable(
  env: NodeJS.ProcessEnv = process.env,
): LocalStore | null {
  if (usesHttpTransport(env)) return null;
  return hasExplicitLocalOptIn(env) ? new LocalStore() : null;
}
