/**
 * @hasna/knowledge — explicit client mode selection.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * ONE question, answered in ONE place: does this process read and write the
 * on-box store, or the app's HTTP API?
 *
 * The rule is EXPLICIT-ONLY. A mode env var selects the mode; the presence of an
 * API URL or an API key never does. Those two are *pointers* — they say where
 * the cloud is and how to authenticate to it, not that we should be talking to
 * it. Selection by presence is what made an ambient `HASNA_KNOWLEDGE_API_URL` +
 * `HASNA_KNOWLEDGE_API_KEY` exported in a login shell silently route a test
 * suite's writes to the live store: every pane inherited the variables from the
 * tmux server, nothing in the CLI said which backend it had picked, and the
 * symptom surfaced as a flood of unrelated test failures.
 *
 * Two layers used to infer cloud from presence, and BOTH had to be closed:
 *   1. this package's own resolver (deleted — it lived in cloud-store.ts), and
 *   2. `resolveClientTransport` in @hasna/contracts, which independently maps
 *      "url and key are both set" to cloud.
 * So callers must not hand the raw environment to the contracts resolver. They
 * pass {@link pinnedTransportEnv}, which stamps the mode WE resolved over
 * whatever the ambient environment says, in both directions. With the mode
 * pinned, the contracts presence-inference can never fire, and the two layers
 * cannot disagree about which store is authoritative.
 *
 * Nothing here reads a credential value, opens a file, or makes a request, so
 * `knowledge mode` can report the resolved backend on a machine with no config
 * and no network.
 */
import { clientTransportEnvKeys } from '@hasna/contracts/client';
import { normalizeStorageMode, type StorageMode } from './generated/storage-kit/index.js';
import { isNetworkGuardActive } from './net-guard.js';

/** App slug behind every `HASNA_KNOWLEDGE_*` / `KNOWLEDGE_*` env key. */
export const KNOWLEDGE_APP_SLUG = 'knowledge';

const ENV_KEYS = clientTransportEnvKeys(KNOWLEDGE_APP_SLUG);

/**
 * Mode env keys in precedence order, canonical first. Sourced from
 * @hasna/contracts rather than restated here: this list has to be the SAME list
 * the transport resolver consults, or a key we ignore could still flip the
 * transport underneath us.
 */
export const KNOWLEDGE_MODE_ENV_KEYS: readonly string[] = ENV_KEYS.modeKeys;
/** Pointer keys: where the cloud is. Never a mode selector. */
export const KNOWLEDGE_API_URL_ENV_KEYS: readonly string[] = ENV_KEYS.apiUrlKeys;
/** Pointer keys: how to authenticate. Never a mode selector, never logged. */
export const KNOWLEDGE_API_KEY_ENV_KEYS: readonly string[] = ENV_KEYS.apiKeyKeys;

/** `local` = on-box store. `cloud` = the app's HTTP `/v1` API. */
export type KnowledgeMode = StorageMode;

export interface KnowledgeModeSource {
  /** `env` when a mode var selected it, `default` when nothing did. */
  kind: 'env' | 'default';
  /** The env key that selected the mode, or null for the default. */
  name: string | null;
  /** The mode var's own value (`local` / `cloud` / a deprecated alias). Never a pointer value. */
  value: string | null;
}

export interface KnowledgeModeResolution {
  mode: KnowledgeMode;
  source: KnowledgeModeSource;
  /**
   * NAMES of pointer vars that are set. Names only, never values: one of these
   * holds an API key and another holds a URL, and this object is printed by the
   * `mode` reporter and embedded in error messages.
   */
  pointer_env_present: string[];
  /**
   * True when pointers are set but did NOT choose the backend. This is exactly
   * the configuration that used to flip silently, so it is reported rather than
   * inferred from the two other fields by every caller.
   */
  pointer_ignored: boolean;
  /** Operator-facing note naming the variable to change, or null. */
  warning: string | null;
}

function presentEnvNames(env: NodeJS.ProcessEnv, keys: readonly string[]): string[] {
  return keys.filter((key) => (env[key] ?? '').trim().length > 0);
}

/**
 * Resolve the mode for this process from an explicit setting alone.
 *
 * Precedence: the first mode key that carries a value wins and RETURNS — the
 * pointer keys are not even read on that path, which is what makes an explicit
 * `KNOWLEDGE_MODE=local` authoritative on a machine whose shell exports a URL
 * and a key. With no mode key set the answer is `local`, the safe default,
 * regardless of what pointers exist.
 *
 * Throws only on an unusable mode value (never on pointer state) so a typo in
 * the one variable that matters fails loudly instead of quietly reading the
 * wrong store.
 */
export function resolveKnowledgeModeSelection(env: NodeJS.ProcessEnv = process.env): KnowledgeModeResolution {
  const pointers = [
    ...presentEnvNames(env, KNOWLEDGE_API_URL_ENV_KEYS),
    ...presentEnvNames(env, KNOWLEDGE_API_KEY_ENV_KEYS),
  ];
  const canonicalModeKey = KNOWLEDGE_MODE_ENV_KEYS[0];

  for (const name of KNOWLEDGE_MODE_ENV_KEYS) {
    const value = env[name]?.trim();
    if (!value) continue;
    // Name the offending key in the failure. `Unknown storage mode: hosted` on
    // its own leaves the operator guessing which of four vars to edit.
    let normalized: ReturnType<typeof normalizeStorageMode>;
    try {
      normalized = normalizeStorageMode(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`knowledge: ${name}=${value} is not a valid mode. ${message}`);
    }
    const warnings: string[] = [];
    if (normalized.deprecatedAlias) {
      warnings.push(
        `Deprecated mode '${normalized.deprecatedAlias}' from ${name} is treated as 'cloud'. Prefer ${canonicalModeKey}=cloud.`,
      );
    }
    if (name !== canonicalModeKey) {
      warnings.push(`Using alias env ${name}; the canonical key is ${canonicalModeKey}.`);
    }
    if (normalized.mode === 'local' && pointers.length > 0) {
      warnings.push(`${name}=local pins the on-box store; ${pointers.join(', ')} are set but ignored.`);
    }
    return {
      mode: normalized.mode,
      source: { kind: 'env', name, value },
      pointer_env_present: pointers,
      pointer_ignored: normalized.mode === 'local' && pointers.length > 0,
      warning: warnings.length > 0 ? warnings.join(' ') : null,
    };
  }

  return {
    mode: 'local',
    source: { kind: 'default', name: null, value: null },
    pointer_env_present: pointers,
    pointer_ignored: pointers.length > 0,
    warning:
      pointers.length > 0
        ? `${pointers.join(', ')} are set but do NOT select a backend: mode is local by default. `
          + `Set ${canonicalModeKey}=cloud to route reads and writes to the API, or unset those vars to silence this note.`
        : null,
  };
}

/**
 * The env to hand @hasna/contracts, with the mode we resolved stamped on top.
 *
 * Load-bearing in BOTH directions. Stamping `cloud` keeps the transport from
 * refusing a mode we deliberately chose; stamping `local` is what stops
 * `resolveClientTransport` from re-deriving cloud out of the ambient pointer
 * vars we just decided to ignore. Handing it the raw environment instead would
 * put the backend choice back in a second layer.
 */
export function pinnedTransportEnv(env: NodeJS.ProcessEnv, mode: KnowledgeMode): NodeJS.ProcessEnv {
  return { ...env, [KNOWLEDGE_MODE_ENV_KEYS[0]]: mode };
}

export interface KnowledgeModeReport extends KnowledgeModeResolution {
  /** `local` -> the on-box store; `api` -> the HTTP `/v1` transport. */
  store_transport: 'local' | 'api';
  /** Whether an API key is available at all. Presence only — never the value. */
  api_key_present: boolean;
  /** Whether the outbound request guard is refusing non-loopback traffic. */
  network_guard_active: boolean;
}

/**
 * The payload behind `knowledge mode`. Deliberately derived from the
 * environment alone: no store open, no config file read, no request. An
 * operator on a machine that cannot reach the network still gets a truthful
 * answer about which backend this CLI would use, which is the thing that was
 * impossible to tell without reading source.
 */
export function knowledgeModeReport(env: NodeJS.ProcessEnv = process.env): KnowledgeModeReport {
  const resolution = resolveKnowledgeModeSelection(env);
  return {
    ...resolution,
    store_transport: resolution.mode === 'cloud' ? 'api' : 'local',
    api_key_present: presentEnvNames(env, KNOWLEDGE_API_KEY_ENV_KEYS).length > 0,
    network_guard_active: isNetworkGuardActive(env),
  };
}
