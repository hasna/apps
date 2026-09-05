/**
 * The credential the CLI signs in with, and the identity it displays.
 *
 * READING is not done here. Every read goes through `fleet-credentials.ts` →
 * `@hasna/contracts/client`, so the argument, the env pointer, the macOS
 * Keychain, `~/.hasna/skills/config/credentials` and `HASNA_SKILLS_API_KEY` are
 * consulted in the fleet's one order, on every call. There is no cache: a
 * credential is mutable state, and a value captured at process start is the
 * defect the ladder exists to remove (a shell that outlives a key rotation).
 *
 * WRITING lands in exactly one file — `~/.hasna/skills/config/credentials`,
 * mode 0600, the shared seam's disk tier — so `skills auth login` on this
 * machine and a station wrapper reading the same file cannot disagree.
 * `HASNA_HOME` / `HASNA_CONFIG_HOME` relocate it; `$HASNA_SKILLS_DIR` does not,
 * because that variable relocates this app's DATA (corpus, database, config),
 * and the fleet credential is not app data — it is the machine's, shared with
 * every other Hasna CLI.
 *
 * The display identity (`email`, org, user ids) is NOT a credential and lives
 * beside it in `identity.json`. It is only ever what the server's `whoami`
 * returned; nothing here invents a field.
 *
 * `~/.skills/auth.json` and `~/.hasna/skills/auth.json` are retired locations and
 * are not read. `skills auth login` writes the credentials file; an operator
 * still holding an old auth.json is told to sign in again.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  requireSkillsApiOrigin,
  resolveSkillsFleet,
  skillsCredentialFilePath,
  SKILLS_API_KEY_ENV,
  SKILLS_API_URL_ENV,
  type SkillsFleetOptions,
} from "./fleet-credentials.js";

export { normalizeSkillsApiOrigin } from "./fleet-credentials.js";

type Env = Record<string, string | undefined>;

/** The credentials file this package writes and the shared seam reads. */
export function getAuthFilePath(env: Env = process.env): string {
  return skillsCredentialFilePath(env);
}

/**
 * Write-free path resolution for read-only paths (e.g. `sync --dry-run`).
 *
 * Identical to getAuthFilePath(): nothing in the credential path writes as a
 * side effect of resolving any more. Kept as a separate name so the read-only
 * callers keep reading as read-only.
 */
export function getAuthFilePathReadOnly(env: Env = process.env): string {
  return skillsCredentialFilePath(env);
}

/** The display identity file beside the credential. Never holds a secret. */
export function getIdentityFilePath(env: Env = process.env): string {
  return join(dirname(skillsCredentialFilePath(env)), "identity.json");
}

/**
 * Stored credentials for a Skills API instance.
 *
 * `apiKey` is the credential the ladder resolved — not necessarily one this CLI
 * wrote. The identity fields are display metadata echoed back from the
 * instance's `whoami`, so they are optional: an instance that does not return
 * them leaves them unset. They are never invented locally — a placeholder
 * written here is indistinguishable from a value the server actually returned.
 */
export interface AuthConfig {
  apiKey: string;
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
  const apiKey = getApiKey(env, options);
  if (!apiKey) return null;
  return { apiKey, ...readIdentity(env) };
}

/** Alias kept for the read-only callers; resolution never writes. */
export function getAuthConfigReadOnly(env: Env = process.env, options: SkillsFleetOptions = {}): AuthConfig | null {
  return getAuthConfig(env, options);
}

/** Merge `values` into the credentials file, atomically, at mode 0600. */
function writeCredentialValues(values: Record<string, string | null>, env: Env = process.env): string {
  const file = skillsCredentialFilePath(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });

  const lines: string[] = [];
  const written = new Set<string>();
  if (existsSync(file)) {
    for (const raw of readFileSync(file, "utf-8").split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(raw);
      const key = match?.[1];
      if (key && key in values) {
        const next = values[key];
        if (next !== null && next !== undefined) {
          lines.push(`${key}=${next}`);
          written.add(key);
        }
        // A null value deletes the line.
        continue;
      }
      lines.push(raw);
    }
  }
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || written.has(key)) continue;
    lines.push(`${key}=${value}`);
  }

  const body = lines.filter((line, index) => !(line.trim() === "" && index === lines.length - 1)).join("\n") + "\n";
  // Written through a sibling temp file so a reader never sees a half-written
  // credential, and created 0600 from the start so it is never briefly readable.
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, body, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
  return file;
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

/**
 * Persist the credential (and any identity the server returned) for this user.
 *
 * Returns the file it wrote, so the CLI can name the real path rather than a
 * path it assumed.
 */
export function saveAuthConfig(config: AuthConfig, env: Env = process.env): string {
  const apiKey = config.apiKey.trim();
  if (!apiKey) throw new Error("Refusing to store an empty Skills API key.");
  if (/[^\t\x20-\x7e]/.test(apiKey)) {
    throw new Error("Refusing to store a Skills API key containing control characters or non-ASCII bytes.");
  }
  const file = writeCredentialValues({ [SKILLS_API_KEY_ENV]: apiKey }, env);

  const identity: AuthIdentity = {};
  for (const field of ["email", "orgId", "orgSlug", "userId"] as const) {
    const value = config[field];
    if (typeof value === "string" && value.length > 0) identity[field] = value;
  }
  const identityFile = getIdentityFilePath(env);
  if (Object.keys(identity).length > 0) {
    writeFileSync(identityFile, JSON.stringify(identity, null, 2) + "\n", { mode: 0o600 });
  } else {
    try { unlinkSync(identityFile); } catch {}
  }
  return file;
}

/** Store (or clear, with null) the API URL beside the credential. */
export function saveApiUrl(apiUrl: string | null, env: Env = process.env): string {
  return writeCredentialValues({ [SKILLS_API_URL_ENV]: apiUrl }, env);
}

/** The API URL recorded in the credentials file, or null. */
export function readStoredApiUrl(env: Env = process.env): string | null {
  return readCredentialValue(SKILLS_API_URL_ENV, env);
}

/**
 * Remove the credential this CLI wrote.
 *
 * Only the file is cleared: a key injected from the environment or held in the
 * Keychain belongs to the machine, not to this command, and silently appearing
 * to remove it would be a lie. The caller is told whether one still resolves.
 */
export function clearAuthConfig(env: Env = process.env): { stillResolves: boolean } {
  try {
    writeCredentialValues({ [SKILLS_API_KEY_ENV]: null }, env);
  } catch {
    // No home, or nothing to clear.
  }
  try { unlinkSync(getIdentityFilePath(env)); } catch {}
  return { stillResolves: Boolean(getApiKey(env)) };
}

/** The credential in effect, resolved fresh through the shared ladder. */
export function getApiKey(env: Env = process.env, options: SkillsFleetOptions = {}): string | null {
  const fleet = resolveSkillsFleet(env, options);
  return fleet.mode === "hosted" ? fleet.apiKey : null;
}

/** Identical to getApiKey(): resolution has no write side effects. */
export function getApiKeyReadOnly(env: Env = process.env, options: SkillsFleetOptions = {}): string | null {
  return getApiKey(env, options);
}

/**
 * Origin every credential-bearing request is sent to.
 *
 * The AUTHORITY, not the whole hosted resolution: `skills auth login` runs
 * before there is a credential, and requiring one here would make signing in
 * impossible. Throws when nothing names a service: an install that named none
 * must not decide on the user's behalf where their email address, login code,
 * or API key goes.
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
