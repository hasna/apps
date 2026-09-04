import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { requireApiUrl } from "./api-url.js";
import { getDataDir, getDataDirReadOnly } from "./config.js";

/**
 * auth.json lives at the skills app root, beside config.json.
 *
 * Resolved through getDataDir() so that $HASNA_SKILLS_DIR relocates the
 * credential file along with the rest of the app's state. It used to be an
 * import-time constant composed from homedir(), so with the override set the
 * CLI stored its API key at <skills data root>/auth.json while config, corpus,
 * and database all moved — the same override-only-half-works split getDataDir()
 * documents for its own history.
 *
 * The legacy ~/.skills/auth.json stays a $HOME concern, exactly like
 * getDataDir()'s legacy merge (which is deliberately skipped for an overridden
 * dir): it is still read as a fallback and removed by clearAuthConfig(), but
 * never written when the override is set. Like getDataDir(), the home is read
 * from the environment at call time — os.homedir() caches its answer after the
 * first call, so a process that re-points $HOME would keep composing the old
 * path.
 */
export function getAuthFilePath(): string {
  return join(getDataDir(), "auth.json");
}

/**
 * Write-free credential path resolution for read-only paths (e.g. `sync --dry-run`).
 *
 * getAuthFilePath() routes through getDataDir(), which WRITES (mkdirs the app dir,
 * merges legacy ~/.skills content, copies the legacy config). A dry run must read
 * the same credential file a real run would without performing any of that.
 */
export function getAuthFilePathReadOnly(): string {
  return join(getDataDirReadOnly(), "auth.json");
}

function legacyAuthFilePath(): string {
  return join(process.env["HOME"] || process.env["USERPROFILE"] || homedir(), ".skills", "auth.json");
}

/**
 * Stored credentials for a Skills API instance.
 *
 * `apiKey` is the only credential. The identity fields are display metadata
 * echoed back from the instance's `whoami`, so they are optional: an instance
 * that does not return them leaves them unset. They are never invented locally
 * — a placeholder written here is indistinguishable from a value the server
 * actually returned once it is read back out of `auth.json`.
 */
export interface AuthConfig {
  apiKey: string;
  email?: string;
  orgId?: string;
  orgSlug?: string;
  userId?: string;
}

let cachedConfig: AuthConfig | null | undefined;

export function getAuthConfig(): AuthConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  try {
    const file = existsSync(getAuthFilePath()) ? getAuthFilePath() : legacyAuthFilePath();
    const raw = readFileSync(file, "utf-8");
    const config = JSON.parse(raw) as AuthConfig;
    if (!config.apiKey) {
      cachedConfig = null;
      return null;
    }
    cachedConfig = config;
    return config;
  } catch {
    cachedConfig = null;
    return null;
  }
}

export function saveAuthConfig(config: AuthConfig): void {
  const file = getAuthFilePath();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  cachedConfig = config;
}

export function clearAuthConfig(): void {
  try { unlinkSync(getAuthFilePath()); } catch {}
  try { unlinkSync(legacyAuthFilePath()); } catch {}
  // Invalidating, not recording "nothing was found": null is the cached answer
  // for "I read the file and it held nothing", and returning it would make every
  // subsequent read miss a credential written after the clear. undefined means
  // "never looked", which is the state a fresh process is in.
  cachedConfig = undefined;
}

export function getApiKey(): string | null {
  if (process.env.SKILLS_API_KEY) return process.env.SKILLS_API_KEY;
  if (process.env.SKILL_API_KEY) return process.env.SKILL_API_KEY;
  return getAuthConfig()?.apiKey || null;
}

/**
 * Write-free credential read for read-only paths (e.g. `sync --dry-run`).
 *
 * getAuthConfig() resolves through getAuthFilePath() -> getDataDir(), which
 * writes. Reads the same files (canonical auth.json, then the legacy ~/.skills
 * fallback) without creating or migrating anything, and without touching the
 * write path's module-level cache.
 */
export function getAuthConfigReadOnly(): AuthConfig | null {
  try {
    const file = existsSync(getAuthFilePathReadOnly()) ? getAuthFilePathReadOnly() : legacyAuthFilePath();
    const raw = readFileSync(file, "utf-8");
    const config = JSON.parse(raw) as AuthConfig;
    if (!config.apiKey) return null;
    return config;
  } catch {
    return null;
  }
}

export function getApiKeyReadOnly(): string | null {
  if (process.env.SKILLS_API_KEY) return process.env.SKILLS_API_KEY;
  if (process.env.SKILL_API_KEY) return process.env.SKILL_API_KEY;
  return getAuthConfigReadOnly()?.apiKey || null;
}

export function normalizeSkillsApiOrigin(apiUrl: string): string {
  const url = new URL(apiUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname === "/api" || pathname === "/api/v1") {
    url.pathname = "/";
  } else if (pathname.endsWith("/api/v1")) {
    url.pathname = pathname.slice(0, -"/api/v1".length) || "/";
  } else if (pathname.endsWith("/api")) {
    url.pathname = pathname.slice(0, -"/api".length) || "/";
  }
  return url.toString().replace(/\/+$/, "");
}

/**
 * Origin every credential-bearing request is sent to.
 *
 * Throws `MissingApiUrlError` when the install has not been pointed at an
 * instance. There is no fallback endpoint: an unconfigured CLI must not decide
 * on the user's behalf where their email address, login code, or API key goes.
 */
export function getApiUrl(action?: string): string {
  return normalizeSkillsApiOrigin(requireApiUrl(action));
}
