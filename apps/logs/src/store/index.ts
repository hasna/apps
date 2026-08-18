/**
 * @hasna/logs — Store resolver.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * ONE entry point that resolves the live {@link Store} from the environment:
 *
 *   HASNA_LOGS_API_URL + HASNA_LOGS_API_KEY
 *       => ApiStore  (HTTP /v1 + bearer key — the hosted API)
 *   otherwise
 *       => LocalStore (on-box SQLite)
 *
 * The two vars are a pair: setting exactly one is a misconfiguration and
 * THROWS rather than silently selecting a store. Callers (CLI, MCP, SDK) call
 * {@link resolveStore} once and hold the interface; they never branch on a
 * storage tier and never touch `getDb()` / raw `fetch` directly. Fully
 * reversible: unset both vars and the next call resolves to local.
 */
import { resolveStorageClient } from "@hasna/contracts/client/storage";
import { ApiStore } from "./api.ts";
import { LocalStore } from "./local.ts";
import type { Store } from "./types.ts";

export type { Store } from "./types.ts";
export { LocalStore } from "./local.ts";
export { ApiStore } from "./api.ts";

/** App slug used for the client env keys (HASNA_LOGS_*). */
export const LOGS_APP_SLUG = "logs";

const API_URL_KEYS = ["HASNA_LOGS_API_URL", "LOGS_API_URL"] as const;
const API_KEY_KEYS = ["HASNA_LOGS_API_KEY", "LOGS_API_KEY"] as const;

function firstSet(env: NodeJS.ProcessEnv, keys: readonly string[]): boolean {
  return keys.some((k) => (env[k]?.trim() ?? "") !== "");
}

/** True when the hosted-API client env pair is present. */
export function isApiMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return firstSet(env, API_URL_KEYS) && firstSet(env, API_KEY_KEYS);
}

/**
 * Resolve the live {@link Store} from the environment. Returns an
 * {@link ApiStore} when the hosted client env pair is present
 * (HASNA_LOGS_API_URL + HASNA_LOGS_API_KEY), else a {@link LocalStore}.
 * Setting exactly one of the pair, or a hosted pair the client transport
 * rejects, THROWS — never a silent fallback to local.
 */
export function resolveStore(env: NodeJS.ProcessEnv = process.env): Store {
  const urlSet = firstSet(env, API_URL_KEYS);
  const keySet = firstSet(env, API_KEY_KEYS);
  if (urlSet !== keySet) {
    throw new Error(
      `${API_URL_KEYS[0]} and ${API_KEY_KEYS[0]} must be set together ` +
        `(got URL ${urlSet ? "set" : "unset"}, KEY ${keySet ? "set" : "unset"}). ` +
        `Unset both to use the local store.`,
    );
  }
  if (!urlSet) return new LocalStore();
  // `cloud-http` is the installed @hasna/contracts client-transport
  // discriminator (its enum token, owned by that package — renamed there when
  // the contracts package drops its own deployment-mode concept).
  const resolved = resolveStorageClient(LOGS_APP_SLUG, env);
  if (resolved.transport === "cloud-http") {
    return new ApiStore(resolved.client);
  }
  // Fail closed: with both vars set, a non-hosted resolution means the client
  // transport rejected the configuration (e.g. an invalid URL). That is a
  // misconfiguration, never a reason to silently read the local dataset.
  throw new Error(
    `Hosted client configured (${API_URL_KEYS[0]} + ${API_KEY_KEYS[0]}) but ` +
      `the transport did not resolve to the hosted client. Fix the URL, or unset ` +
      `both vars to use the local store.`,
  );
}

/**
 * Return the concrete {@link LocalStore} for on-box maintenance/compute
 * operations that have no hosted data model (db repair, subprocess capture,
 * file follow, event-store diagnostics). Throws loudly in api mode instead of
 * silently touching a stale local db. Fully reversible: unset the API vars.
 */
export function requireLocalStore(
  operation: string,
  env: NodeJS.ProcessEnv = process.env,
): LocalStore {
  if (isApiMode(env)) {
    throw new Error(
      `'${operation}' is a local-only operation and cannot run against the hosted API ` +
        `(the hosted tier is a shared log sink). Unset ${API_URL_KEYS[0]}/${API_KEY_KEYS[0]} ` +
        `to run it against the local store.`,
    );
  }
  return new LocalStore();
}

/**
 * Best-effort {@link LocalStore} for internal self-telemetry: returns a store
 * when local, or `null` in api mode (where the events catalog has no home).
 * Callers must treat telemetry as optional and never let it change behavior.
 */
export function localStoreIfAvailable(
  env: NodeJS.ProcessEnv = process.env,
): LocalStore | null {
  return isApiMode(env) ? null : new LocalStore();
}
