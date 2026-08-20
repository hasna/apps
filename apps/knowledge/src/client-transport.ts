/**
 * @hasna/knowledge — client transport selection.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * A Knowledge client has exactly two connections: its on-box SQLite/JSON
 * stores or the server HTTP API. The canonical API URL selects HTTP; without
 * that URL the client stays on-box. Server database configuration is handled
 * separately and never participates in this decision.
 */
import { isNetworkGuardActive } from './net-guard.js';

export const KNOWLEDGE_APP_SLUG = 'knowledge';
export const KNOWLEDGE_API_URL_ENV = 'HASNA_KNOWLEDGE_API_URL';
export const KNOWLEDGE_API_KEY_ENV = 'HASNA_KNOWLEDGE_API_KEY';
export const KNOWLEDGE_DATABASE_URL_ENV = 'HASNA_KNOWLEDGE_DATABASE_URL';

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
  source: typeof KNOWLEDGE_API_URL_ENV | 'default';
  api_url_present: boolean;
  api_key_present: boolean;
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
        + `Clients select the HTTP API when ${KNOWLEDGE_API_URL_ENV} and ${KNOWLEDGE_API_KEY_ENV} are set; `
        + `without ${KNOWLEDGE_API_URL_ENV} they use local SQLite. `
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
 * Once-only per-process guard for the local-fallback notice. A long-running
 * consumer (MCP server) must not emit a notice per request; a CLI one-shot
 * emits at most one line before its first local read.
 */
let knowledgeLocalFallbackNoticeEmitted = false;

/** Test hook: re-arm the once-only local-fallback notice. */
export function resetKnowledgeLocalFallbackNotice(): void {
  knowledgeLocalFallbackNoticeEmitted = false;
}

/**
 * Emit one machine-readable JSON line on stderr when the client falls back to
 * the on-box store with no hosted intent in the environment (the default
 * branch). Incident 715712: a harness session-env re-provision dropped
 * HASNA_KNOWLEDGE_API_URL + HASNA_KNOWLEDGE_API_KEY and the CLI silently
 * served the local store at rc=0 — items appeared gone. The notice names the
 * mode switch so a false-empty read is never silent (the same family as the
 * merged secrets fix, PR #681 / incident 715558). stdout stays pure for
 * parsers. Values are never included.
 */
function emitKnowledgeLocalFallbackNotice(env: NodeJS.ProcessEnv): void {
  if (knowledgeLocalFallbackNoticeEmitted) return;
  knowledgeLocalFallbackNoticeEmitted = true;
  const notice = {
    event: 'knowledge-local-fallback',
    transport: 'sqlite',
    source: 'default',
    apiUrlPresent: isPresent(env, KNOWLEDGE_API_URL_ENV),
    apiKeyPresent: isPresent(env, KNOWLEDGE_API_KEY_ENV),
    notice:
      `No hosted API config (${KNOWLEDGE_API_URL_ENV} + ${KNOWLEDGE_API_KEY_ENV}) is present; ` +
      'using local SQLite. Hosted knowledge is NOT visible in this output.',
  };
  console.error(JSON.stringify(notice));
}

/**
 * Resolve the client connection from canonical environment variables only.
 * An API URL without its credential fails closed instead of drifting to the
 * on-box store. Values are never included in the report or in errors.
 */
export function resolveKnowledgeClientTransport(
  env: NodeJS.ProcessEnv = process.env,
): KnowledgeClientTransportReport {
  assertNoRetiredKnowledgeStorageSelector(env);
  const apiUrlPresent = isPresent(env, KNOWLEDGE_API_URL_ENV);
  const apiKeyPresent = isPresent(env, KNOWLEDGE_API_KEY_ENV);

  if (apiUrlPresent && !apiKeyPresent) {
    throw new Error(
      `knowledge: ${KNOWLEDGE_API_URL_ENV} selects the HTTP API, but ${KNOWLEDGE_API_KEY_ENV} is missing. `
        + `Set ${KNOWLEDGE_API_KEY_ENV}, or unset ${KNOWLEDGE_API_URL_ENV} to use local SQLite.`,
    );
  }

  if (!apiUrlPresent) {
    emitKnowledgeLocalFallbackNotice(env);
  }

  return {
    transport: apiUrlPresent ? 'http' : 'sqlite',
    source: apiUrlPresent ? KNOWLEDGE_API_URL_ENV : 'default',
    api_url_present: apiUrlPresent,
    api_key_present: apiKeyPresent,
    network_guard_active: isNetworkGuardActive(env),
  };
}
