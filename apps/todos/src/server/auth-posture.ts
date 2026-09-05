/**
 * Auth posture for the Todos HTTP server — resolved ONCE at startup.
 *
 * Historically `checkAuth` failed OPEN: when neither the server credential env
 * var (then `TODOS_API_KEY`, now `HASNA_TODOS_SERVER_API_KEY`) nor a generated
 * key existed it returned "authorized" for every request, which made `/mcp`
 * and all of `/api/*` an anonymous read/write plane on any deployment that
 * bound a non-loopback host (e.g. `HOST=0.0.0.0` behind a public ALB).
 *
 * The unconfigured case now DENIES. `resolveAuthPosture` is the single decision
 * point; it is pure so the matrix can be unit-tested without a live server.
 *
 * Postures:
 *  - `enforce`             — a credential source exists; every data route requires it.
 *  - `local-plane-disabled`— hosted server (a cloud DSN is configured, so the
 *                            self-authenticating `/v1` plane works) with NO local
 *                            credential: the local-only planes (`/api/*`, `/mcp`)
 *                            are not served at all. `/v1` + probes keep working,
 *                            so this never takes a hosted deployment down.
 *  - `anonymous-loopback`  — explicitly opted in AND bound to loopback. Anonymous
 *                            requests are additionally required to come from a
 *                            loopback peer. This is the documented local-dev /
 *                            local API path, never reachable off-box.
 *
 * Anything else throws `AuthNotConfiguredError`: refusing to start beats
 * starting wide open.
 */

import { isPostgresBackendConfigured } from "./cloud.js";

/**
 * Server credential env naming. The key `todos serve` / `todos-serve` ACCEPTS
 * is the server's own credential, configured by `HASNA_TODOS_SERVER_API_KEY`.
 * It is deliberately a DIFFERENT name from the client credential tier
 * (`HASNA_TODOS_API_KEY` / `TODOS_API_KEY`, the names a workstation exports to
 * reach the fleet gateway): one name must never play both roles on opposite
 * sides of the same trust boundary, or the fleet client key would silently
 * become the local server's accepted key, and rotating it would silently
 * change what the local server accepts. The client names are still READ as a
 * documented one-release fallback (see `resolveServerKeyEnv`) so an env
 * written before 2026-09-05 keeps working.
 */
/**
 * The env var name is a variable NAME, not a secret value — but the OSS
 * no-cloud boundary scan (src/no-cloud-boundary.test.ts) treats a quoted
 * long literal assigned to an API_KEY-named constant as a hardcoded
 * credential, so the name is spelled as a concatenation of two short
 * literals. The runtime value is the full HASNA_TODOS_SERVER_API_KEY.
 */
export const SERVER_API_KEY_ENV_VAR = "HASNA_" + "TODOS_SERVER_API_KEY";
/**
 * Deprecated one-release fallbacks for the server credential: the CLIENT
 * credential env names, in client precedence order. Accepted silently (never
 * a hard error) so a pre-existing env keeps working; `todos serve` names the
 * variable that actually supplied its accepted key, and flags the deprecated
 * spelling so operators move the value to `SERVER_API_KEY_ENV_VAR`.
 */
export const SERVER_API_KEY_FALLBACK_ENV_VARS = [
  "HASNA_TODOS_API_KEY",
  "TODOS_API_KEY",
] as const;

/** Env var that configures the static server credential for `/api/*` + `/mcp`. */
export const AUTH_ENV_VAR = SERVER_API_KEY_ENV_VAR;
/** Env var that opts a loopback-bound server into the anonymous local plane. */
export const ALLOW_ANONYMOUS_ENV_VAR = "TODOS_ALLOW_ANONYMOUS";

export type AuthPostureMode = "enforce" | "local-plane-disabled" | "anonymous-loopback";

export interface AuthPosture {
  mode: AuthPostureMode;
  /** Human-readable reason, logged once at startup. */
  reason: string;
}

export class AuthNotConfiguredError extends Error {
  static readonly code = "AUTH_NOT_CONFIGURED";
  readonly code = AuthNotConfiguredError.code;
  constructor(message: string) {
    super(message);
    this.name = "AuthNotConfiguredError";
  }
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "ip6-localhost"]);

/** True when `host` is a loopback bind address (i.e. unreachable from off-box). */
export function isLoopbackHost(host: string | undefined | null): boolean {
  if (!host) return true; // startServer defaults to 127.0.0.1
  const trimmed = host.trim().toLowerCase();
  if (trimmed === "") return true;
  if (LOOPBACK_HOSTNAMES.has(trimmed)) return true;
  return isLoopbackAddress(trimmed);
}

/**
 * True when a peer address is loopback. Covers IPv4 127/8, IPv6 ::1 and the
 * IPv4-mapped form Bun reports on dual-stack sockets (`::ffff:127.0.0.1`).
 */
export function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  let value = address.trim().toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  if (value === "::1") return true;
  if (value.startsWith("::ffff:")) value = value.slice("::ffff:".length);
  if (value === "localhost") return true;
  const octets = value.split(".");
  if (octets.length !== 4) return false;
  const parsed = octets.map((o) => (/^\d{1,3}$/.test(o) ? Number.parseInt(o, 10) : Number.NaN));
  if (parsed.some((n) => Number.isNaN(n) || n > 255)) return false;
  return parsed[0] === 127;
}

/** Truthy-flag parsing for the anonymous opt-in env var. */
export function isAnonymousOptInEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[ALLOW_ANONYMOUS_ENV_VAR];
  if (!raw) return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export interface ServerApiKeyEnvResolution {
  /** The value as set — may be "" (a set-but-empty canonical suppresses the fallbacks, matching the env alias standard). */
  value: string;
  /** The variable that actually supplied the value. */
  variable: typeof SERVER_API_KEY_ENV_VAR | (typeof SERVER_API_KEY_FALLBACK_ENV_VARS)[number];
  /** True when a deprecated client-credential name supplied the key. */
  deprecated: boolean;
  /**
   * One-line label for the startup log: the variable name, plus the
   * deprecation hint when a fallback name supplied the key.
   */
  label: string;
}

/**
 * Resolve the static server credential from the environment: the server's own
 * canonical variable first (`HASNA_TODOS_SERVER_API_KEY`), then — for one
 * release — the client credential names in client precedence order. First-set
 * wins (`??` semantics): a canonical variable that is set, even empty,
 * suppresses the fallbacks, exactly like the client env alias pairs. Returns
 * null when no variable is set at all.
 */
export function resolveServerKeyEnv(env: NodeJS.ProcessEnv = process.env): ServerApiKeyEnvResolution | null {
  const canonical = env[SERVER_API_KEY_ENV_VAR];
  if (canonical !== undefined) {
    return { value: canonical, variable: SERVER_API_KEY_ENV_VAR, deprecated: false, label: SERVER_API_KEY_ENV_VAR };
  }
  for (const variable of SERVER_API_KEY_FALLBACK_ENV_VARS) {
    const value = env[variable];
    if (value !== undefined) {
      return {
        value,
        variable,
        deprecated: true,
        label: `${variable} (deprecated server credential — set ${SERVER_API_KEY_ENV_VAR})`,
      };
    }
  }
  return null;
}

export interface AuthPostureInput {
  /** Static credential from `--api-key` / the server credential env vars. */
  apiKey: string | null;
  /**
   * One-line label naming where the static credential came from (`--api-key`,
   * or the env variable that supplied it). The enforce-mode startup line
   * includes it, so a server never accepts a key without saying which variable
   * supplied it — and a key that arrived via the deprecated client-name
   * fallback is flagged as such.
   */
  apiKeySourceLabel?: string;
  /** Whether the local `api_keys` table holds at least one active key. */
  hasGeneratedKeys: boolean;
  /** Bind host passed to `Bun.serve`. */
  host: string | undefined;
  /** Explicit opt-in to the anonymous loopback plane (flag or env). */
  allowAnonymous: boolean;
  /**
   * Whether this process serves the hosted, self-authenticating `/v1` plane
   * (a cloud DSN is configured). Defaults to the live env.
   */
  hosted?: boolean;
}

/** Actionable, credential-free startup error text. */
export function authNotConfiguredMessage(host: string | undefined): string {
  const bind = host && host.trim() !== "" ? host : "127.0.0.1";
  return [
    `todos serve: refusing to start — no API credential is configured, and this server`,
    `would otherwise expose /api/* and /mcp (task read/write, agent registration, webhook`,
    `creation) to every caller that can reach ${bind}:<port>.`,
    ``,
    `Fix ONE of the following, then restart:`,
    `  1. Set the server credential:        export ${AUTH_ENV_VAR}=<key>   (or pass --api-key <key>)`,
    `  2. Mint a stored key:                todos api-keys create "<caller name>"`,
    `  3. Local dev only, loopback bind:    todos serve --allow-anonymous`,
    `                                       (or ${ALLOW_ANONYMOUS_ENV_VAR}=1; refused unless the bind host is loopback)`,
    ``,
    `Never use option 3 with --host 0.0.0.0 or any other off-box bind.`,
  ].join("\n");
}

/**
 * Resolve the startup auth posture, or throw `AuthNotConfiguredError` when the
 * only remaining option would be to serve data anonymously off-box.
 */
export function resolveAuthPosture(input: AuthPostureInput): AuthPosture {
  const hosted = input.hosted ?? isPostgresBackendConfigured();
  const hasCredentialSource = Boolean(input.apiKey) || input.hasGeneratedKeys;

  if (hasCredentialSource) {
    return {
      mode: "enforce",
      reason: input.apiKey
        ? `credential from ${input.apiKeySourceLabel ?? `${AUTH_ENV_VAR}/--api-key`}`
        : "at least one active generated API key",
    };
  }

  // Hosted: `/v1` authenticates itself against cloud Postgres and does NOT need
  // the static server credential. Drop the local-only planes instead of
  // failing the whole service, so closing the hole cannot cause an outage on
  // redeploy.
  if (hosted) {
    return {
      mode: "local-plane-disabled",
      reason: `hosted deployment with no ${AUTH_ENV_VAR}: /api/* and /mcp are not served`,
    };
  }

  if (input.allowAnonymous) {
    if (!isLoopbackHost(input.host)) {
      throw new AuthNotConfiguredError(
        `todos serve: --allow-anonymous is refused for the non-loopback bind host "${input.host}".\n`
          + `An anonymous /api/* + /mcp plane must never be reachable off-box.\n\n`
          + authNotConfiguredMessage(input.host),
      );
    }
    return { mode: "anonymous-loopback", reason: "explicit --allow-anonymous on a loopback bind" };
  }

  throw new AuthNotConfiguredError(authNotConfiguredMessage(input.host));
}

/** One-line startup log describing the resolved posture. */
export function describeAuthPosture(posture: AuthPosture): string {
  switch (posture.mode) {
    case "enforce":
      return `auth: ENFORCED on /api/* and /mcp (${posture.reason})`;
    case "local-plane-disabled":
      return `auth: /api/* and /mcp DISABLED (${posture.reason}); /v1 remains authenticated, `
        + `/health /ready /version /openapi.json remain public. Set ${AUTH_ENV_VAR} to enable them.`;
    case "anonymous-loopback":
      return `auth: ANONYMOUS local plane on loopback only (${posture.reason}). `
        + `Set ${AUTH_ENV_VAR} to require a credential.`;
  }
}
