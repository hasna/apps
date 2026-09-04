/**
 * @hasna/knowledge — client transport selection.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * A Knowledge client has exactly two connections: its on-box SQLite/JSON
 * stores or the server HTTP API. The canonical API URL selects HTTP; the
 * on-box stores are served ONLY under an explicit opt-in
 * (HASNA_KNOWLEDGE_LOCAL) — never as the no-configuration default, so a
 * process whose fleet API env was dropped fails closed instead of silently
 * serving a possibly-stale local dataset (owner directive 2026-09-04). Server
 * database configuration is handled separately and never participates in this
 * decision.
 */
import { isNetworkGuardActive } from './net-guard.js';

export const KNOWLEDGE_APP_SLUG = 'knowledge';
export const KNOWLEDGE_API_URL_ENV = 'HASNA_KNOWLEDGE_API_URL';
export const KNOWLEDGE_API_KEY_ENV = 'HASNA_KNOWLEDGE_API_KEY';
export const KNOWLEDGE_DATABASE_URL_ENV = 'HASNA_KNOWLEDGE_DATABASE_URL';
/**
 * Explicit on-box opt-in. Set this (any non-empty value; the canonical value
 * is `1`) to serve the on-box SQLite/JSON stores WITHOUT the hosted API env.
 * It authorizes the missing-URL branch only: when HASNA_KNOWLEDGE_API_URL and
 * HASNA_KNOWLEDGE_API_KEY are both present the HTTP API is selected and this
 * variable is not consulted — a set of live credentials is never downgraded
 * to local by a stray opt-in (that silent downgrade is the failure class this
 * module exists to close).
 */
export const KNOWLEDGE_LOCAL_ENV = 'HASNA_KNOWLEDGE_LOCAL';

/** Canonical client variables. Compatibility aliases are intentionally absent. */
export const KNOWLEDGE_API_URL_ENV_KEYS = [KNOWLEDGE_API_URL_ENV] as const;
export const KNOWLEDGE_API_KEY_ENV_KEYS = [KNOWLEDGE_API_KEY_ENV] as const;

/**
 * Removed selector names. They remain here only as a fail-loud ratchet so a
 * stale station fragment cannot be silently ignored.
 */
export const RETIRED_KNOWLEDGE_SELECTOR_ENV_KEYS = [
  'HASNA_KNOWLEDGE_STORAGE_MODE',
  'HASNA_KNOWLEDGE_MODE',
  'KNOWLEDGE_STORAGE_MODE',
  'KNOWLEDGE_MODE',
] as const;

export type KnowledgeClientTransport = 'sqlite' | 'http';

export interface KnowledgeClientTransportReport {
  transport: KnowledgeClientTransport;
  /** The env key that selected the transport (never a value, never 'default'). */
  source: typeof KNOWLEDGE_API_URL_ENV | typeof KNOWLEDGE_LOCAL_ENV;
  api_url_present: boolean;
  api_key_present: boolean;
  local_opt_in_present: boolean;
  network_guard_active: boolean;
}

function isPresent(env: NodeJS.ProcessEnv, key: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(env, key)) return false;
  return (env[key] ?? '').trim().length > 0;
}

function firstDefined(env: NodeJS.ProcessEnv, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined) return key;
  }
  return null;
}

export class RetiredKnowledgeStorageSelectorError extends Error {
  readonly code = 'retired_knowledge_storage_selector';

  constructor(readonly envKey: string) {
    super(
      `knowledge: ${envKey} was retired and must be unset. `
        + `Clients select the HTTP API when ${KNOWLEDGE_API_URL_ENV} and ${KNOWLEDGE_API_KEY_ENV} are set, `
        + `or the on-box store under the explicit opt-in ${KNOWLEDGE_LOCAL_ENV}=1; `
        + `with neither, they fail closed. `
        + `Servers select PostgreSQL with ${KNOWLEDGE_DATABASE_URL_ENV}.`,
    );
    this.name = 'RetiredKnowledgeStorageSelectorError';
  }
}

/** Reject stale selector variables even when their value is blank. */
export function assertNoRetiredKnowledgeStorageSelector(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const retired = firstDefined(env, RETIRED_KNOWLEDGE_SELECTOR_ENV_KEYS);
  if (retired) throw new RetiredKnowledgeStorageSelectorError(retired);
}

/**
 * Resolve the client connection from canonical environment variables only.
 *
 * Fail-closed by default (owner directive 2026-09-04): with NO hosted API
 * config and NO explicit on-box opt-in the resolver throws an actionable
 * error instead of silently serving the on-box store at rc=0. That silent
 * default was incident 715712 — a harness session-env re-provision dropped
 * HASNA_KNOWLEDGE_API_URL + HASNA_KNOWLEDGE_API_KEY and the CLI served the
 * local store at exit 0, so items appeared gone. The old mitigation (one
 * stderr `knowledge-local-fallback` notice at exit 0) is gone with it: a
 * notice-and-continue is still a false green to anything checking the exit
 * code. On-box reads and writes now require HASNA_KNOWLEDGE_LOCAL=1 (or the
 * CLI's explicit `--store` override, which pins the on-box transport before
 * this resolver is consulted).
 *
 * Precedence: the API URL + key pair selects HTTP even when
 * HASNA_KNOWLEDGE_LOCAL is also set — the local opt-in authorizes the
 * missing-URL branch only and never downgrades live credentials to local.
 * An API URL without its credential fails closed. Values are never included
 * in the report or in errors.
 */
export function resolveKnowledgeClientTransport(
  env: NodeJS.ProcessEnv = process.env,
): KnowledgeClientTransportReport {
  assertNoRetiredKnowledgeStorageSelector(env);
  const apiUrlPresent = isPresent(env, KNOWLEDGE_API_URL_ENV);
  const apiKeyPresent = isPresent(env, KNOWLEDGE_API_KEY_ENV);
  const localOptInPresent = isPresent(env, KNOWLEDGE_LOCAL_ENV);

  if (apiUrlPresent && !apiKeyPresent) {
    throw new Error(
      `knowledge: ${KNOWLEDGE_API_URL_ENV} selects the HTTP API, but ${KNOWLEDGE_API_KEY_ENV} is missing. `
        + `Set ${KNOWLEDGE_API_KEY_ENV}, or unset ${KNOWLEDGE_API_URL_ENV} and set ${KNOWLEDGE_LOCAL_ENV}=1 `
        + `to explicitly use the on-box store.`,
    );
  }

  if (!apiUrlPresent && !localOptInPresent) {
    throw new Error(
      `knowledge: no hosted API configuration and no explicit on-box choice. `
        + `Set ${KNOWLEDGE_API_URL_ENV} and ${KNOWLEDGE_API_KEY_ENV} to use the server API, `
        + `or set ${KNOWLEDGE_LOCAL_ENV}=1 to explicitly use the on-box store. `
        + `Refusing to serve the on-box store without an explicit choice.`,
    );
  }

  return {
    transport: apiUrlPresent ? 'http' : 'sqlite',
    source: apiUrlPresent ? KNOWLEDGE_API_URL_ENV : KNOWLEDGE_LOCAL_ENV,
    api_url_present: apiUrlPresent,
    api_key_present: apiKeyPresent,
    local_opt_in_present: localOptInPresent,
    network_guard_active: isNetworkGuardActive(env),
  };
}
