/**
 * The credential the CLI runs with, and the identity it displays.
 *
 * READING is not done here. Every read goes through `fleet-credentials.ts` →
 * `@hasna/contracts/client`, so the argument, the env pointer, the macOS
 * Keychain, `~/.hasna/skills/config/credentials` and `HASNA_SKILLS_API_KEY` are
 * consulted in the fleet's one order, on every call. There is no cache: a
 * credential is mutable state, and a value captured at process start is the
 * defect the ladder exists to remove (a shell that outlives a key rotation).
 *
 * WRITING does not happen here — or anywhere in this package. Credential
 * provisioning is a separate, owner-authorised workflow (fleet credential rule
 * 2026-09-09; fail-closed ruling 2026-09-07, hasna/apps#1720): the Keychain
 * item, the credentials file and the environment variable are placed by the
 * operator's provisioning step, never by `skills auth login`. Until 0.5.10 this
 * module wrote the credentials file (and an `identity.json` sidecar) on login,
 * on `setup --api-url` and on workspace enrollment; those writers are gone. The
 * verbs that used them now print WHERE the value belongs — see
 * {@link credentialPlacement} — and never a value.
 *
 * The display identity (`email`, org, user ids) is NOT a credential. An
 * `identity.json` written beside the credentials file by an earlier release is
 * still read for display; nothing here writes or invents one.
 *
 * `~/.skills/auth.json` and `~/.hasna/skills/auth.json` are retired locations and
 * are not read.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { defaultFleetGatewayBaseUrl } from "@hasna/contracts/client";
import { SKILLS_BOUND_API_URL } from "./instance-credentials.js";

import {
  requireSkillsApiOrigin,
  resolveSkillsApiKey,
  resolveSkillsFleet,
  skillsCredentialFilePath,
  SKILLS_API_KEY_ENV,
  SKILLS_API_URL_ENV,
  SKILLS_APP,
  normalizeSkillsApiOrigin,
  resolveSkillsApiOrigin,
  type SkillsFleetOptions,
} from "./fleet-credentials.js";

export { normalizeSkillsApiOrigin } from "./fleet-credentials.js";

type Env = Record<string, string | undefined>;

/** The credentials file the shared seam reads (this package only reads it too). */
export function getAuthFilePath(env: Env = process.env): string {
  return skillsCredentialFilePath(env);
}

/**
 * Identical to getAuthFilePath(): nothing in the credential path writes as a
 * side effect of resolving. Kept as a separate name so the read-only callers
 * keep reading as read-only.
 */
export function getAuthFilePathReadOnly(env: Env = process.env): string {
  return skillsCredentialFilePath(env);
}

/** The display identity file beside the credential. Never holds a secret. */
export function getIdentityFilePath(env: Env = process.env): string {
  const file = skillsCredentialFilePath(env);
  return join(dirname(file), basename(file).replace(/^credentials/, "identity") + ".json");
}

/**
 * Stored credentials for a Skills API instance.
 *
 * `apiKey` is the credential the ladder resolved. The identity fields are
 * display metadata echoed back from the instance's `whoami`, so they are
 * optional: an instance that does not return them leaves them unset.
 */
export interface AuthConfig {
  /**
   * The credential the ladder resolved, or null when it is a vault POINTER that
   * only the async path can complete (see {@link getApiKeyAsync}). Callers that
   * need to SEND it must resolve it there; the display surfaces below only need
   * to know that one is configured.
   */
  apiKey: string | null;
  email?: string;
  orgId?: string;
  orgSlug?: string;
  userId?: string;
}

/** The identity half, on its own: what `whoami` said, with no credential. */
export type AuthIdentity = Omit<AuthConfig, "apiKey">;

export function getAuthIdentity(env: Env = process.env): AuthIdentity {
  return readIdentity(env);
}

function readIdentity(env: Env = process.env): AuthIdentity {
  try {
    const parsed = JSON.parse(readFileSync(getIdentityFilePath(env), "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const selected = resolveSkillsApiOrigin(env)?.origin;
    const bound = typeof record.apiUrl === "string" ? record.apiUrl : readCredentialValue(SKILLS_BOUND_API_URL, env) ?? readStoredApiUrl(env) ?? defaultFleetGatewayBaseUrl("skills");
    if (selected && normalizeSkillsApiOrigin(bound) !== selected) return {};
    const identity: AuthIdentity = {};
    for (const field of ["email", "orgId", "orgSlug", "userId"] as const) {
      const value = record[field];
      if (typeof value === "string" && value.length > 0) identity[field] = value;
    }
    return identity;
  } catch {
    return {};
  }
}

/**
 * The credential in effect plus whatever identity was recorded for it, or null
 * when no credential resolves anywhere on the ladder.
 */
export function getAuthConfig(env: Env = process.env, options: SkillsFleetOptions = {}): AuthConfig | null {
  const fleet = resolveSkillsFleet(env, options);
  if (fleet.mode !== "hosted") return null;
  // A vault pointer IS a configured credential; keyed off the synchronous value
  // alone this reported "not signed in" for one, which is a false negative the
  // operator would chase in the wrong place.
  return { apiKey: fleet.apiKey, ...readIdentity(env) };
}

/** Alias kept for the read-only callers; resolution never writes. */
export function getAuthConfigReadOnly(env: Env = process.env, options: SkillsFleetOptions = {}): AuthConfig | null {
  return getAuthConfig(env, options);
}

/** Read one value out of the credentials file, or null. */
function readCredentialValue(key: string, env: Env = process.env): string | null {
  let file: string;
  try {
    file = skillsCredentialFilePath(env);
  } catch {
    return null;
  }
  if (!existsSync(file)) return null;
  try {
    for (const raw of readFileSync(file, "utf-8").split(/\r?\n/)) {
      const match = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)$`).exec(raw);
      if (!match) continue;
      let value = (match[1] ?? "").trim();
      const quote = value[0];
      if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
        value = value.slice(1, -1);
      }
      return value || null;
    }
  } catch {
    return null;
  }
  return null;
}

/** The API URL recorded in the credentials file, or null. */
export function readStoredApiUrl(env: Env = process.env): string | null {
  return readCredentialValue(SKILLS_API_URL_ENV, env) ?? readCredentialValue("SKILLS_API_URL", env);
}

/**
 * The stable code every former writer verb answers with. A script that used to
 * rely on `skills auth login` or `skills setup --api-url` writing a file sees
 * this code and the placement, never a silently unchanged exit 0.
 */
export const CREDENTIAL_STORE_UNMANAGED = "CREDENTIAL_STORE_UNMANAGED";

/** Where a Skills credential (and, for your own instance, its address) belongs. Names only. */
export interface CredentialPlacement {
  /** macOS Keychain generic-password item for the key. */
  keychainItem: string;
  /** macOS Keychain generic-password item for your own instance's address. */
  keychainUrlItem: string;
  /** The Keychain account rule the shared resolver applies. */
  keychainAccount: string;
  /** The credentials file this environment resolves, or null when HOME is unset. */
  credentialsFile: string | null;
  /** The lines that file takes (placeholders, never values). */
  credentialsFileLines: string[];
  /** The environment tier for the key. */
  envKey: string;
  /** The environment tier for the address. */
  envUrlKey: string;
}

/**
 * The three places the shared ladder reads a credential from, for a verb that
 * has to tell the operator where to put one. Contains no value and names no
 * vendor host.
 */
export function credentialPlacement(env: Env = process.env): CredentialPlacement {
  let credentialsFile: string | null;
  try {
    credentialsFile = skillsCredentialFilePath(env);
  } catch {
    credentialsFile = null;
  }
  return {
    keychainItem: `hasna.credentials.${SKILLS_APP}.api-key`,
    keychainUrlItem: `hasna.credentials.${SKILLS_APP}.api-url`,
    keychainAccount: "HASNA_STATION, else the host name",
    credentialsFile,
    credentialsFileLines: [`${SKILLS_API_KEY_ENV}=<key>`, `${SKILLS_API_URL_ENV}=<origin>  # only for your own instance`],
    envKey: SKILLS_API_KEY_ENV,
    envUrlKey: SKILLS_API_URL_ENV,
  };
}

/** One line naming where `subject` belongs, prefixed with the stable code. */
export function credentialPlacementMessage(env: Env = process.env, subject = "the Skills API key"): string {
  const p = credentialPlacement(env);
  return (
    `${CREDENTIAL_STORE_UNMANAGED}: this CLI does not write credentials. Place ${subject} where the shared ladder reads it: ` +
    `the macOS Keychain item ${p.keychainItem} (account ${p.keychainAccount}), ` +
    `a ${p.envKey}=<key> line in ${p.credentialsFile ?? "~/.hasna/skills/config/credentials"} (mode 0600), ` +
    `or the ${p.envKey} environment variable. Your own instance's address goes in ${p.keychainUrlItem}, ` +
    `a ${p.envUrlKey}=<origin> line in the same file, or ${p.envUrlKey}.`
  );
}

/**
 * The credential in effect, resolved fresh through the shared ladder.
 *
 * SYNCHRONOUS, so it cannot complete a vault pointer
 * (`HASNA_SKILLS_API_KEY_REF`): for that tier it returns null, because the
 * pointer's own value is the empty string and handing THAT back as a key is how
 * `Authorization: Bearer ` reached the wire. Any path that is about to SEND the
 * key must use {@link getApiKeyAsync} (or `resolveSkillsApiKey`), which fetches
 * the vault item and refuses loudly when it cannot.
 */
export function getApiKey(env: Env = process.env, options: SkillsFleetOptions = {}): string | null {
  const fleet = resolveSkillsFleet(env, options);
  return fleet.mode === "hosted" ? fleet.apiKey : null;
}

/**
 * The credential in effect, completing a vault pointer through the secrets
 * vault. Null only in local mode; throws when a configured credential cannot
 * be produced. Use this wherever the key is about to be sent.
 */
export async function getApiKeyAsync(
  env: Env = process.env,
  options: SkillsFleetOptions = {},
): Promise<string | null> {
  return resolveSkillsApiKey(env, options);
}

/** Identical to getApiKey(): resolution has no write side effects. */
export function getApiKeyReadOnly(env: Env = process.env, options: SkillsFleetOptions = {}): string | null {
  return getApiKey(env, options);
}

/**
 * Origin every credential-bearing request is sent to.
 *
 * The AUTHORITY, not the whole hosted resolution: `skills auth login` runs
 * before there is a credential, and requiring one here would make requesting a
 * code impossible. Throws when nothing names a service: an install that named
 * none must not decide on the user's behalf where their email address or login
 * code goes.
 */
export function getApiUrl(action?: string, env: Env = process.env, options: SkillsFleetOptions = {}): string {
  return requireSkillsApiOrigin(action, env, options);
}

/** Permission bits of the credentials file, for `skills auth status`-style output. */
export function credentialFileMode(env: Env = process.env): number | null {
  try {
    return statSync(skillsCredentialFilePath(env)).mode & 0o777;
  } catch {
    return null;
  }
}
