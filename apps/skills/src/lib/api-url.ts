/**
 * Single source of truth for resolving the Skills API endpoint.
 *
 * Boundary rule (R1): an unconfigured install must never produce a URL on a
 * vendor-controlled host.
 *
 *   - Read paths fail closed: `resolveApiUrl()` returns `undefined` and the
 *     caller keeps working against the bundled local registry.
 *   - Auth and write paths fail loudly: `requireApiUrl()` throws an error that
 *     names the missing configuration.
 *
 * There is deliberately no fallback endpoint and no localhost default. An
 * unconfigured CLI has nothing sane to point a credential-bearing request at,
 * so it must say so rather than pick a host on the user's behalf.
 */

import { loadConfig, type SkillsConfig } from "./config.js";

export const API_URL_ENV_VAR = "SKILLS_API_URL";
export const API_URL_CONFIG_KEY = "apiUrl";

/**
 * Resolve the canonical API authority to DISPLAY for a configured base URL
 * (issue #1588).
 *
 * Station wrappers configure the gateway form `https://api.hasna.com/<app>`
 * (no `/v1`); requests go to `https://api.hasna.com/<app>/v1/...`. Status and
 * whoami surfaces must therefore print the RESOLVED `/v1` root — never the
 * bare base URL and never the origin alone.
 *
 * Normalization is intentionally limited to the gateway form. Legacy origins
 * (`https://<app>.hasna.xyz`, allowed for todos until hasna/apps#1512 ships)
 * and self-hosted/custom endpoints keep the caller's existing display behavior:
 * this returns `null` for anything that is not `https://api.hasna.com/<app>`
 * or the already-resolved `https://api.hasna.com/<app>/v1`.
 */
export function gatewayApiV1Root(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "api.hasna.com") return null;
  // Username, password, query and fragment are never part of the resolved
  // authority: refuse rather than echo operator-supplied credential material.
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 1 && segments[0] !== "v1") {
    // Bare gateway form: `https://api.hasna.com/<app>` → resolved `/v1` root.
    return `https://api.hasna.com/${segments[0]}/v1`;
  }
  if (segments.length === 2 && segments[1] === "v1") {
    // Already the canonical form: report it unchanged.
    return `https://api.hasna.com/${segments[0]}/v1`;
  }
  return null;
}

/** Hint shown wherever a Skills API URL is required but absent. */
export const MISSING_API_URL_HINT =
  `set ${API_URL_ENV_VAR}=<your Skills instance origin>, ` +
  `or run: skills setup --api-url <your Skills instance origin>`;

export class MissingApiUrlError extends Error {
  readonly code = "MISSING_API_URL";

  constructor(action = "This command") {
    super(`${action} requires a Skills API URL and none is configured — ${MISSING_API_URL_HINT}`);
    this.name = "MissingApiUrlError";
  }
}

/**
 * Resolve the configured Skills API origin, or `undefined` when the install has
 * not been pointed at an instance. `SKILLS_API_URL` wins over the config file.
 */
export function resolveApiUrl(
  config: SkillsConfig = loadConfig(),
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = env[API_URL_ENV_VAR] || config[API_URL_CONFIG_KEY];
  const trimmed = raw?.trim().replace(/\/+$/, "");
  return trimmed || undefined;
}

/**
 * Resolve the configured Skills API origin, or throw naming the missing
 * configuration. Use this on every auth and write path.
 */
export function requireApiUrl(
  action = "This command",
  config?: SkillsConfig,
  env?: Record<string, string | undefined>,
): string {
  const resolved = resolveApiUrl(config ?? loadConfig(), env ?? process.env);
  if (!resolved) throw new MissingApiUrlError(action);
  return resolved;
}
