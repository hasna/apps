/**
 * Auth posture for the calendar HTTP server — resolved ONCE at startup, before
 * the socket is bound.
 *
 * THE BUG THIS REPLACES. `serve()` mounted `/mcp` *after* `handleV1Request`,
 * and `handleV1Request` returns `null` for any path that is not `/v1*`. The
 * only auth choke point in the process therefore never saw `/mcp`, and
 * `src/mcp/http.ts` has no auth of its own. On calendar-prod (bound `0.0.0.0`
 * behind a public ALB) that published the full 23-tool MCP catalogue — including
 * `create_org`, `register_agent`, `create_event`, `update_event`, `delete_event`
 * and `add_member` — to completely anonymous callers, while `GET /v1/orgs`
 * correctly answered 401. The transport is stateless
 * (`sessionIdGenerator: undefined`), so no handshake was needed.
 *
 * Note the difference from the same-class todos defect: todos had a `checkAuth`
 * that FAILED OPEN; calendar had a route MOUNTED OUTSIDE the guard. The posture
 * model below is shared because the right end state is the same — a hosted
 * process with a remote store and no local credential should not serve the
 * local plane AT ALL rather than serving it wide open.
 *
 * Postures:
 *  - `enforce`              a serve credential exists; `/mcp` requires it.
 *  - `local-plane-disabled` hosted (an app-scoped database URL) with NO serve
 *                           credential: `/mcp` is not mounted at all.
 *                           `/v1` (self-authenticating) and the probes keep
 *                           working, so closing the hole cannot take the hosted
 *                           deployment down.
 *  - `anonymous-loopback`   explicitly opted in AND bound to loopback AND the
 *                           request's raw transport peer is loopback.
 *
 * Anything else throws `AuthNotConfiguredError`: refusing to start beats
 * starting wide open.
 */

// NOTE: this module deliberately has NO imports. `src/mcp/http.ts` uses its
// primitives, and `src/mcp/index.ts` imports `./http.js`, so anything imported
// here is pulled into the local-first CLI/MCP bundle. Importing `./cloud.js`
// for a default `hosted` value dragged @hasna/contracts/auth, the Postgres
// store and the cloud query client into `dist/mcp` — the caller passes `hosted`
// explicitly instead.

/** Env var carrying the shared credential for the local plane (`/mcp`). */
export const SERVE_AUTH_ENV_VARS = ["CALENDAR_SERVE_API_KEY", "HASNA_CALENDAR_SERVE_API_KEY"] as const;
/** Env var that opts a loopback-bound server into the anonymous local plane. */
export const ALLOW_ANONYMOUS_ENV_VAR = "CALENDAR_ALLOW_ANONYMOUS";

/**
 * Deliberately NOT reused as the serve credential: `HASNA_CALENDAR_API_KEY` /
 * `CALENDAR_API_KEY` are the *client*-flip vars that `resolveClientTransport`
 * reads to point the CLI/MCP at a remote `/v1`. Accepting them here would make
 * a serve process authenticate callers with the same value it uses to call
 * itself, and would flip `getStore()` to the ApiStore as a side effect of
 * configuring auth. The serve credential has its own name.
 */
export type AuthPostureMode = "enforce" | "local-plane-disabled" | "anonymous-loopback";

export interface AuthPosture {
  mode: AuthPostureMode;
  /** Human-readable reason, logged once at startup. Never contains the credential. */
  reason: string;
  /** The expected credential when `mode === "enforce"`. */
  credential: string | null;
}

/**
 * Thrown when the local `/mcp` plane would be served against a DIFFERENT store
 * than the hosted `/v1` plane in the same process.
 *
 * This is the defect-2 failure mode, gated behind a credential rather than
 * anonymous: `/v1` always uses `getCloudStore()` (Postgres), while `/mcp` uses
 * `getStore()`, which is the on-box SQLite `LocalStore` unless the client-flip
 * env is set. A hosted process that enables `/mcp` without that env would hand
 * authenticated callers a private SQLite island while reporting itself hosted.
 */
export class SplitStorePlaneError extends Error {
  static readonly code = "SPLIT_STORE_PLANE";
  readonly code = SplitStorePlaneError.code;
  constructor(message: string) {
    super(message);
    this.name = "SplitStorePlaneError";
  }
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
  if (host === undefined || host === null) return true; // serve() defaults to 127.0.0.1
  const trimmed = host.trim().toLowerCase();
  if (trimmed === "") return true;
  if (LOOPBACK_HOSTNAMES.has(trimmed)) return true;
  return isLoopbackAddress(trimmed);
}

/**
 * True when a peer address is loopback. Covers IPv4 127/8, IPv6 `::1` and the
 * IPv4-mapped form Bun reports on dual-stack sockets (`::ffff:127.0.0.1`).
 * Reject anything else, including `::ffff:10.0.0.1` and `127.0.0.1.evil.com`.
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

/** Resolve the serve credential from env (first non-empty wins). */
export function resolveServeCredential(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const key of SERVE_AUTH_ENV_VARS) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

export interface AuthPostureInput {
  /** Static credential from `--api-key` / `CALENDAR_SERVE_API_KEY`. */
  credential: string | null;
  /** Bind host passed to `Bun.serve`. */
  host: string | undefined;
  /** Explicit opt-in to the anonymous loopback plane (flag or env). */
  allowAnonymous: boolean;
  /**
   * Whether this process serves the hosted, self-authenticating `/v1` plane
   * (an app-scoped database URL). Required: resolved by the caller via
   * `hasHostedDatabase()` so this module stays import-free.
   */
  hosted: boolean;
  /**
   * What `getStore()` — the store behind every MCP tool — resolves to. Passed
   * in (rather than resolved here) to keep this module import-free.
   */
  localPlaneTransport: "local" | "http-api";
}

/** Actionable, credential-free startup error text. */
export function authNotConfiguredMessage(host: string | undefined): string {
  const bind = host && host.trim() !== "" ? host : "127.0.0.1";
  return [
    `calendar-serve: refusing to start — no serve credential is configured, and this`,
    `server would otherwise expose /mcp (create_org, register_agent, create_event,`,
    `update_event, delete_event, add_member, …) to every caller that can reach`,
    `${bind}:<port>.`,
    ``,
    `Fix ONE of the following, then restart:`,
    `  1. Set the serve credential:      export ${SERVE_AUTH_ENV_VARS[0]}=<key>  (or pass --api-key <key>)`,
    `  2. Run hosted:                    configure HASNA_CALENDAR_DATABASE_URL — /v1 stays`,
    `                                    authenticated and /mcp is simply not served.`,
    `  3. Local dev only, loopback bind: calendar-serve --allow-anonymous`,
    `                                    (or ${ALLOW_ANONYMOUS_ENV_VAR}=1; refused unless the bind host is loopback)`,
    ``,
    `Never use option 3 with --host 0.0.0.0 or any other off-box bind.`,
  ].join("\n");
}

/**
 * Resolve the startup auth posture, or throw `AuthNotConfiguredError` when the
 * only remaining option would be to serve data anonymously off-box.
 */
export function resolveAuthPosture(input: AuthPostureInput): AuthPosture {
  const hosted = input.hosted;
  const credential = input.credential && input.credential.trim() !== "" ? input.credential.trim() : null;

  // A configured credential always wins over the anonymous opt-in.
  if (credential) {
    if (hosted && input.localPlaneTransport === "local") {
      throw new SplitStorePlaneError(
        [
          `calendar-serve: refusing to start — this is a HOSTED deployment (/v1 reads and writes`,
          `the shared Postgres), but ${SERVE_AUTH_ENV_VARS[0]} would also enable /mcp, whose 23 tools`,
          `go through getStore(). getStore() currently resolves to the on-box SQLite store, so the`,
          `two planes of this one process would be on two DIFFERENT datasets — the exact split this`,
          `release exists to remove.`,
          ``,
          `Fix ONE of the following, then restart:`,
          `  1. Do not serve the local plane here: unset ${SERVE_AUTH_ENV_VARS[0]}.`,
          `     /v1 keeps working and /mcp is simply not served (posture local-plane-disabled).`,
          `  2. Put /mcp on the SAME store: resolve a Calendar client credential (set HASNA_CALENDAR_API_URL`,
          `     and HASNA_CALENDAR_API_KEY, or use the Keychain item hasna.credentials.calendar.api-key / the`,
          `     ~/.hasna/calendar/config/credentials file) so getStore() routes through the /v1 API instead of`,
          `     on-box SQLite.`,
        ].join("\n"),
      );
    }
    return {
      mode: "enforce",
      reason: `credential from ${SERVE_AUTH_ENV_VARS[0]}/--api-key`,
      credential,
    };
  }

  // Hosted: `/v1` authenticates itself against cloud Postgres and needs no
  // serve credential. Drop the local-only plane instead of failing the whole
  // service, so closing the hole cannot cause an outage on redeploy.
  if (hosted) {
    return {
      mode: "local-plane-disabled",
      reason: `hosted deployment with no ${SERVE_AUTH_ENV_VARS[0]}: /mcp is not served`,
      credential: null,
    };
  }

  if (input.allowAnonymous) {
    if (!isLoopbackHost(input.host)) {
      throw new AuthNotConfiguredError(
        `calendar-serve: --allow-anonymous is refused for the non-loopback bind host "${input.host}".\n`
          + `An anonymous /mcp plane must never be reachable off-box.\n\n`
          + authNotConfiguredMessage(input.host),
      );
    }
    return {
      mode: "anonymous-loopback",
      reason: "explicit --allow-anonymous on a loopback bind",
      credential: null,
    };
  }

  throw new AuthNotConfiguredError(authNotConfiguredMessage(input.host));
}

/** One-line startup log describing the resolved posture. Never logs the credential. */
export function describeAuthPosture(posture: AuthPosture): string {
  switch (posture.mode) {
    case "enforce":
      return `auth: ENFORCED on /mcp (${posture.reason})`;
    case "local-plane-disabled":
      return `auth: /mcp DISABLED (${posture.reason}); /v1 remains authenticated, `
        + `/health /ready /version /openapi.json remain public. Set ${SERVE_AUTH_ENV_VARS[0]} to enable it.`;
    case "anonymous-loopback":
      return `auth: ANONYMOUS local plane on loopback only (${posture.reason}). `
        + `Set ${SERVE_AUTH_ENV_VARS[0]} to require a credential.`;
  }
}

/** Constant-time string comparison (avoids leaking the credential via timing). */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  // Length is compared without an early return so the loop always runs.
  let diff = aBytes.length ^ bBytes.length;
  const max = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < max; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

/** Extract a presented credential from `Authorization: Bearer …` or `x-api-key`. */
export function presentedCredential(headers: Headers): string | null {
  const apiKey = headers.get("x-api-key");
  if (apiKey && apiKey.trim() !== "") return apiKey.trim();
  const authorization = headers.get("authorization");
  if (authorization) {
    const match = /^bearer\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1] && match[1].trim() !== "") return match[1].trim();
  }
  return null;
}

export type LocalPlaneDecision =
  | { allow: true }
  | { allow: false; status: number; body: { error: string; code: string } };

const UNAUTHORIZED: LocalPlaneDecision = {
  allow: false,
  status: 401,
  body: { error: "authentication required", code: "UNAUTHENTICATED" },
};

const DISABLED: LocalPlaneDecision = {
  allow: false,
  // 404, not 403: on a hosted deployment the local plane does not exist at all,
  // and a 403 would still confirm the surface to an unauthenticated scanner.
  status: 404,
  body: { error: "not found", code: "LOCAL_PLANE_DISABLED" },
};

/**
 * Authorize one request against the resolved posture.
 * `peer` is the RAW transport peer address (`server.requestIP`), deliberately
 * NOT `x-forwarded-for`: a proxy header must never be able to forge loopback.
 */
export function authorizeLocalPlane(
  posture: AuthPosture,
  headers: Headers,
  peer: string | undefined | null,
): LocalPlaneDecision {
  switch (posture.mode) {
    case "local-plane-disabled":
      return DISABLED;
    case "enforce": {
      const presented = presentedCredential(headers);
      if (!presented || !posture.credential) return UNAUTHORIZED;
      return timingSafeEqual(presented, posture.credential) ? { allow: true } : UNAUTHORIZED;
    }
    case "anonymous-loopback":
      return isLoopbackAddress(peer) ? { allow: true } : DISABLED;
  }
}
