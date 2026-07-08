/**
 * @hasna/logs — Store resolver.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * ONE entry point that resolves the live {@link Store} from the environment:
 *
 *   HASNA_LOGS_API_URL + HASNA_LOGS_API_KEY  (mode self_hosted/cloud implied)
 *       => ApiStore  (HTTP /v1 + bearer key)
 *   otherwise
 *       => LocalStore (on-box SQLite)
 *
 * Callers (CLI, MCP, SDK) call {@link resolveStore} once and hold the interface;
 * they never branch on mode and never touch `getDb()` / raw `fetch` directly.
 * Fully reversible: unset the two API vars and the next call resolves to local.
 */
import { resolveStorageClient } from "@hasna/contracts/client/storage";
import { ApiStore } from "./api.ts";
import { LocalStore } from "./local.ts";
import type { Store, StoreMode } from "./types.ts";

export type { Store, StoreMode } from "./types.ts";
export { LocalStore } from "./local.ts";
export { ApiStore } from "./api.ts";

/** App slug used for the client-flip env keys (HASNA_LOGS_*). */
export const LOGS_APP_SLUG = "logs";

const MODE_KEYS = [
  "HASNA_LOGS_STORAGE_MODE",
  "HASNA_LOGS_MODE",
  "LOGS_STORAGE_MODE",
  "LOGS_MODE",
] as const;
const API_URL_KEYS = ["HASNA_LOGS_API_URL", "LOGS_API_URL"] as const;
const API_KEY_KEYS = ["HASNA_LOGS_API_KEY", "LOGS_API_KEY"] as const;

function firstSet(env: NodeJS.ProcessEnv, keys: readonly string[]): boolean {
  return keys.some((k) => (env[k]?.trim() ?? "") !== "");
}

function firstValue(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): string | undefined {
  for (const k of keys) {
    const v = env[k]?.trim();
    if (v) return v;
  }
  return undefined;
}

/**
 * The fleet flip writes exactly two vars per app — `HASNA_LOGS_API_URL` and
 * `HASNA_LOGS_API_KEY` — and deliberately does NOT set a storage-mode var.
 * Presence of both API vars therefore *is* self_hosted intent: synthesize
 * `HASNA_LOGS_STORAGE_MODE=self_hosted` so the @hasna/contracts client-flip
 * resolves to `cloud-http`. An explicit mode var is always respected.
 */
function withImpliedSelfHostedMode(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (firstSet(env, MODE_KEYS)) return env;
  if (firstSet(env, API_URL_KEYS) && firstSet(env, API_KEY_KEYS)) {
    return { ...env, HASNA_LOGS_STORAGE_MODE: "self_hosted" };
  }
  return env;
}

function resolvedMode(env: NodeJS.ProcessEnv): StoreMode {
  const raw = firstValue(env, MODE_KEYS)?.toLowerCase();
  return raw === "cloud" ? "cloud" : "self_hosted";
}

/**
 * Resolve the live {@link Store} from the environment. Returns an {@link ApiStore}
 * when the client-flip resolves to cloud-http (API_URL + API_KEY present), else a
 * {@link LocalStore}. Throws if cloud was requested but misconfigured (never a
 * silent fallback to local).
 */
export function resolveStore(env: NodeJS.ProcessEnv = process.env): Store {
  const effective = withImpliedSelfHostedMode(env);
  const resolved = resolveStorageClient(LOGS_APP_SLUG, effective);
  if (resolved.transport === "cloud-http") {
    return new ApiStore(resolved.client, resolvedMode(effective));
  }
  return new LocalStore();
}

/** True when the environment resolves to the HTTP (self_hosted/cloud) transport. */
export function isApiMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const resolved = resolveStorageClient(
    LOGS_APP_SLUG,
    withImpliedSelfHostedMode(env),
  );
  return resolved.transport === "cloud-http";
}

/**
 * Return the concrete {@link LocalStore} for on-box maintenance/compute
 * operations that have no cloud data model (db repair, subprocess capture,
 * file follow, event-store diagnostics). Throws loudly in api mode instead of
 * silently touching a stale local db. Fully reversible: unset the API vars.
 */
export function requireLocalStore(
  operation: string,
  env: NodeJS.ProcessEnv = process.env,
): LocalStore {
  if (isApiMode(env)) {
    throw new Error(
      `'${operation}' is a local-only operation and cannot run in self_hosted/cloud mode (the cloud tier is a shared log sink). Unset HASNA_LOGS_API_URL/HASNA_LOGS_API_KEY to run it against the local store.`,
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
