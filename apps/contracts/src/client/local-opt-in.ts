// The ONE sanctioned door to an on-box store: `HASNA_<APP>_LOCAL=1`.
//
// Owned by contracts so that seventeen apps stop carrying their own copy and
// so the door is answered BEFORE any Keychain or disk read: a scrubbed test
// environment that sets the flag can never reach the machine's shared store,
// and a process that sets it never resolves a hosted credential it will not
// use. `--store <path>`, `--db <path>`, `HASNA_<APP>_DB_PATH` and every
// `*_MODE` word are NOT doors; an argv `--local` may exist only as sugar that
// sets this same signal in-process.
//
// SAFETY: this module reads only the flag and the NAMES of hosted keys. It
// never reads, returns, or prints a credential value.

import { envToken, type Env } from "../env-token.js";
import {
  CREDENTIAL_PROFILE_ENV_KEY,
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
} from "./env-keys.js";
import { ClientResolutionError } from "./errors.js";

/** `HASNA_<APP>_LOCAL` — the canonical opt-in key for an app. */
export function localOptInEnvKey(name: string): string {
  return `HASNA_${envToken(name)}_LOCAL`;
}

/**
 * `<APP>_LOCAL` — the unprefixed alias, accepted for ONE minor release (1.1.x)
 * because that spelling shipped in several apps; removed in 1.2.0.
 */
export function localOptInAliasEnvKey(name: string): string {
  return `${envToken(name)}_LOCAL`;
}

/** Values that turn the opt-in ON (case-insensitive, trimmed). */
export const LOCAL_OPT_IN_TRUE_VALUES = ["1", "true", "yes"] as const;
/** Values that leave it OFF (case-insensitive, trimmed); an unrecognised value is also OFF. */
export const LOCAL_OPT_IN_FALSE_VALUES = ["", "0", "false", "no"] as const;

export type LocalOptInState = "off" | "on" | "conflict";

export interface LocalOptInDescription {
  state: LocalOptInState;
  /** The canonical key, `HASNA_<APP>_LOCAL`. */
  envKey: string;
  /** Which key turned it on (the canonical key or the alias), or null when off. Never a value. */
  source: string | null;
  /** Hosted configuration keys declared alongside an ON flag. Empty unless `state === "conflict"`. */
  conflicts: string[];
  /** False when the flag is declared with a value outside the recognised sets (treated as OFF). */
  recognized: boolean;
}

/**
 * The hosted-client keys whose PRESENCE conflicts with the opt-in. Only the
 * process env is inspected — never the Keychain or a file — so the answer is
 * hermetic and costs no I/O.
 */
export function hostedClientEnvKeys(name: string): string[] {
  const keys = clientTransportEnvKeys(name);
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey(name),
    credentialPointerEnvKey(name),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

function ownStringValue(env: Env, key: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(env, key)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(env, key);
  if (!descriptor || !("value" in descriptor)) return undefined;
  const value = descriptor.value;
  return typeof value === "string" ? value : undefined;
}

function flagState(raw: string | undefined): "on" | "off" | "unrecognized" | "unset" {
  if (raw === undefined) return "unset";
  const normalized = raw.trim().toLowerCase();
  if ((LOCAL_OPT_IN_TRUE_VALUES as readonly string[]).includes(normalized)) return "on";
  if ((LOCAL_OPT_IN_FALSE_VALUES as readonly string[]).includes(normalized)) return "off";
  return "unrecognized";
}

/**
 * Describe the opt-in without throwing. For `status` / `doctor` verbs.
 */
export function describeLocalOptIn(name: string, env: Env = process.env): LocalOptInDescription {
  const envKey = localOptInEnvKey(name);
  const aliasKey = localOptInAliasEnvKey(name);
  const canonical = flagState(ownStringValue(env, envKey));
  const alias = flagState(ownStringValue(env, aliasKey));
  const recognized = canonical !== "unrecognized" && alias !== "unrecognized";

  let on = false;
  let source: string | null = null;
  const conflicts: string[] = [];
  if (canonical === "on") {
    on = true;
    source = envKey;
    if (alias === "off") conflicts.push(aliasKey);
  } else if (canonical === "off") {
    if (alias === "on") conflicts.push(aliasKey);
  } else if (alias === "on") {
    on = true;
    source = aliasKey;
  }

  if (on) {
    for (const key of hostedClientEnvKeys(name)) {
      if (ownStringValue(env, key) !== undefined) conflicts.push(key);
    }
  }
  const state: LocalOptInState = conflicts.length > 0 ? "conflict" : on ? "on" : "off";
  return { state, envKey, source, conflicts, recognized };
}

/**
 * Does this process deliberately select the on-box store?
 *
 * Evaluated BEFORE any Keychain or disk read, from the process env alone.
 * Returns `true` when `HASNA_<APP>_LOCAL` is `1|true|yes` and no hosted client
 * key is declared beside it; `false` when the flag is absent, off, or
 * unrecognised. THROWS `ClientResolutionError` with code
 * `LOCAL_OPT_IN_CONFLICT` (exit 6) when the flag is on while
 * `HASNA_<APP>_API_URL`, `_API_KEY`, `_API_KEY_OVERRIDE`, `_API_KEY_REF`,
 * the unprefixed aliases, or `HASNA_PROFILE` are also declared — a process
 * runs against exactly one store, and it must say which.
 */
export function selectsLocalStore(name: string, env: Env = process.env): boolean {
  const described = describeLocalOptIn(name, env);
  if (described.state === "conflict") {
    throw new ClientResolutionError(
      "LOCAL_OPT_IN_CONFLICT",
      name,
      `${described.source ?? described.envKey} selects the on-box store for '${name}', but ${described.conflicts.join(", ")} ` +
        `${described.conflicts.length === 1 ? "is" : "are"} also declared; a process runs against exactly one store.`,
      {
        sources: [described.source ?? described.envKey, ...described.conflicts],
        remedy: `Unset ${described.envKey} to use the hosted service, or unset the hosted keys to use the on-box store.`,
      },
    );
  }
  return described.state === "on";
}

/**
 * The single stderr line an app prints when the on-box store is selected.
 * Text only — never a JSON event on stdout, where it would be mistaken for data.
 */
export function localStoreNotice(name: string, storePath: string): string {
  return `local mode (${localOptInEnvKey(name)}=1): on-box store ${storePath}; hosted data is NOT visible`;
}
