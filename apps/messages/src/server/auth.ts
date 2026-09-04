/**
 * messages-serve API-key authentication.
 *
 * WHAT CHANGED (hasna/apps#1595). messages used to compare the `x-api-key`
 * header against ONE static string held in `HASNA_MESSAGES_API_KEY`. That is
 * the whole reason messages could not join the fleet: a single shared string
 * has no key id, no scopes, no expiry and no revocation, so
 * `hasna/oss/messages/api-key` could not be minted, rotated or revoked the way
 * every other hosted app's key is. This module moves messages onto the same
 * `@hasna/contracts/auth` key store the rest of the fleet uses:
 *
 *   - stateless HMAC-signed tokens (`hasna_messages_<body>.<sig>`) verified
 *     with the server-held signing secret — no DB round-trip for authenticity;
 *   - a DB-backed {@link ApiKeyStore} on the same Postgres the app already
 *     uses, layering revocation/expiry on top (`api_keys` table, idempotent);
 *   - per-request scope enforcement: reads need `messages:read`, writes need
 *     `messages:write`.
 *
 * Signing-secret resolution (first non-empty wins), matching the fleet
 * convention used by mementos/conversations:
 *
 *   API_KEY_SIGNING_SECRET           (injected by the hasna-app Terraform module)
 *   HASNA_MESSAGES_API_SIGNING_KEY   (per-app convention)
 *   HASNA_API_SIGNING_KEY            (shared fallback)
 *
 * Secrets Manager values carry a trailing newline (hasna/apps#1543), so every
 * secret read here is trimmed before it reaches the HMAC.
 *
 * TRANSITION — the static key stays accepted for ONE release. When
 * `HASNA_MESSAGES_API_KEY` is set it is still honoured (constant-time
 * compared) alongside contracts tokens, and the server warns once on first
 * use. Remove the static branch in the release after the fleet key exists.
 *
 * REVOCATION NEEDS THE DATABASE. Authenticity is stateless, but revocation and
 * expiry live in the `api_keys` table. With no usable
 * `HASNA_MESSAGES_DATABASE_URL` the gate verifies signatures only and cannot
 * refuse a revoked kid, so it warns once at startup rather than degrading in
 * silence — an unnoticed degradation here looks exactly like a working gate.
 *
 * When NEITHER a signing secret nor a static key is configured the server is
 * in trusted-loopback mode and /v1/* is open — `assertSafeBind` in
 * serve-entry.ts is what keeps that mode on the loopback interface.
 *
 * Nothing in this file logs, returns or throws a secret value.
 */
import { timingSafeEqual } from "node:crypto";
import pg from "pg";
import {
  ApiKeyStore,
  verifyApiKey,
  type ApiKeyVerifier,
  type AuthQueryClient,
} from "@hasna/contracts/auth";

/** App slug: the token prefix (`hasna_messages_`) and the scope namespace. */
export const APP = "messages";

/** Scope required by a read (GET/HEAD) request to /v1/*. */
export const READ_SCOPE = `${APP}:read`;
/** Scope required by any state-changing request to /v1/*. */
export const WRITE_SCOPE = `${APP}:write`;

/** The env var holding the legacy single static key, accepted for one release. */
export const STATIC_KEY_ENV = "HASNA_MESSAGES_API_KEY";

/**
 * Signing-secret env names in resolution order. Exported so the tests pin the
 * order rather than restating it, and so an operator can grep for it.
 */
export const SIGNING_SECRET_ENVS = [
  "API_KEY_SIGNING_SECRET",
  "HASNA_MESSAGES_API_SIGNING_KEY",
  "HASNA_API_SIGNING_KEY",
] as const;

export type Env = Record<string, string | undefined>;

/**
 * How the gate is authenticating requests.
 *
 * `contracts` — a signing secret is configured; contracts tokens are verified
 *   (and the static key, if also set, is still accepted for this release).
 * `static`    — only the legacy static key is configured.
 * `open`      — neither; /v1/* is unauthenticated (loopback-only, enforced by
 *   the bind gate).
 */
export type AuthMode = "contracts" | "static" | "open";

/** Resolve the signing secret, trimmed (hasna/apps#1543). */
export function resolveSigningSecret(env: Env): string | undefined {
  for (const name of SIGNING_SECRET_ENVS) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Resolve the legacy static key, trimmed. Empty string means "not set". */
export function resolveStaticKey(env: Env): string | undefined {
  const value = env[STATIC_KEY_ENV]?.trim();
  return value ? value : undefined;
}

/**
 * The scope a request to `/v1/*` must carry.
 *
 * Method-based rather than route-based on purpose: a route table would have to
 * be kept in sync with serve-entry by hand, and the failure mode of drifting
 * out of sync is an unguarded route. Every read in this API is a GET/HEAD and
 * every mutation is a POST, so the method IS the classification.
 */
export function requiredScopeFor(method: string): string {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD" ? READ_SCOPE : WRITE_SCOPE;
}

/** Constant-time string compare that never leaks length through early exit. */
export function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    // Still burn a comparison so the timing does not distinguish
    // "wrong length" from "wrong bytes".
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export interface AuthGate {
  /** How this gate authenticates. */
  readonly mode: AuthMode;
  /** True when /v1/* requires a credential (mode is not `open`). */
  readonly required: boolean;
  /**
   * Gate one request. Returns `null` to allow, or a 401 `Response` to reject.
   * Never throws: a store outage comes back as a deny, not a 500.
   */
  check(req: Request, method: string, path: string): Promise<Response | null>;
}

export interface AuthGateOptions {
  /** Environment to read. Defaults to `process.env`. */
  env?: Env;
  /**
   * Revocation-store client. `undefined` builds one from the app's Postgres
   * URL when configured; `null` explicitly disables the store (stateless
   * verification only, which cannot refuse an unregistered kid).
   */
  queryClient?: AuthQueryClient | null;
  /** Sink for the one-shot static-key deprecation warning. Defaults to console.warn. */
  warn?: (message: string) => void;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Build an {@link AuthQueryClient} over the app's Postgres, or `null` when no
 * database is configured. `pg` is imported lazily so a SQLite-backed local
 * server never pays for it.
 */
export function makeAuthQueryClient(env: Env): AuthQueryClient | null {
  const dsn = env.HASNA_MESSAGES_DATABASE_URL?.trim();
  if (!dsn) return null;
  // A malformed DSN must degrade to stateless verification rather than kill
  // the process at startup: authenticity does not need the database, only
  // revocation does, and a server that refuses to boot is a worse outage than
  // one that cannot see a revocation for a few minutes.
  let pool: pg.Pool;
  try {
    pool = new pg.Pool({ connectionString: dsn });
  } catch {
    return null;
  }
  return {
    many: async (sql, params = []) => (await pool.query(sql, params as unknown[])).rows as never,
    get: async (sql, params = []) => ((await pool.query(sql, params as unknown[])).rows[0] ?? null) as never,
    execute: async (sql, params = []) => {
      await pool.query(sql, params as unknown[]);
    },
  };
}

/**
 * Build the request gate for this server.
 *
 * Construction is explicit (no module-level singleton keyed on `process.env`)
 * so the server builds exactly one gate at startup and the tests build as many
 * as they need with different environments.
 */
export function createAuthGate(options: AuthGateOptions = {}): AuthGate {
  const env = options.env ?? (process.env as Env);
  const warn = options.warn ?? ((m: string) => console.warn(m));
  const signingSecret = resolveSigningSecret(env);
  const staticKey = resolveStaticKey(env);

  if (!signingSecret && !staticKey) {
    return {
      mode: "open",
      required: false,
      check: async () => null,
    };
  }

  let verifier: ApiKeyVerifier | null = null;
  let schemaReady: Promise<void> | null = null;

  if (signingSecret) {
    const client = options.queryClient === undefined ? makeAuthQueryClient(env) : options.queryClient;
    let store: ApiKeyStore | null = null;
    if (client) {
      store = new ApiKeyStore(client);
      // Idempotent, best-effort: a transient DB hiccup must not wedge startup.
      // Stateless verification still holds while the table is being created.
      schemaReady = store.ensureSchema().catch((e: unknown) => {
        warn(`[messages-serve] api_keys ensureSchema failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    } else {
      // Say it once, at startup, loudly. Without a store the verifier can only
      // check that a token was signed by this secret: it cannot see revocation
      // or registration, so a leaked key stays valid until the signing secret
      // itself is rotated — which is precisely the capability hasna/apps#1595
      // was filed to gain. This is legitimate for a loopback/SQLite server; on
      // a hosted one it means the DSN is missing or misconfigured, and that is
      // invisible from the outside because authentication still succeeds.
      warn(
        `[messages-serve] auth mode "contracts" with NO revocation store: ` +
          `HASNA_MESSAGES_DATABASE_URL is unset or unusable, so any correctly signed token is ` +
          `accepted and revoked keys CANNOT be refused. Expected for a local/SQLite server; on a ` +
          `hosted deployment set HASNA_MESSAGES_DATABASE_URL.`,
      );
    }
    verifier = verifyApiKey({
      app: APP,
      signingSecret,
      keyStatus: store ? store.keyStatus : undefined,
      // Without a store there is nothing to check a kid against, and the
      // contracts verifier refuses to be built without either a status hook or
      // this explicit declaration — which would 500 every request. With a
      // store, `keyStatus` above carries the real check and this is ignored.
      allowUnregisteredKeys: store ? undefined : true,
      audit: (e) => {
        if (e.outcome === "deny") {
          warn(`[messages-serve] auth deny kid=${e.kid ?? "-"} reason=${e.reason} ${e.method ?? ""} ${e.path ?? ""}`);
        }
      },
    });
  }

  let staticKeyWarned = false;
  const warnStaticKeyOnce = (): void => {
    if (staticKeyWarned) return;
    staticKeyWarned = true;
    warn(
      `[messages-serve] ${STATIC_KEY_ENV} authenticated a request. The single static key is accepted for ` +
        `ONE more release and cannot be scoped, expired or revoked; mint a fleet key ` +
        `(hasna/oss/messages/api-key) and configure a signing secret instead.`,
    );
  };

  const mode: AuthMode = signingSecret ? "contracts" : "static";

  return {
    mode,
    required: true,
    async check(req: Request, method: string, path: string): Promise<Response | null> {
      const presented = req.headers.get("x-api-key")?.trim() ?? "";

      // The legacy static key is checked FIRST and independently of the
      // contracts verifier: during the transition a station may still hold the
      // old string, and a contracts token is not a valid static key (nor the
      // reverse), so neither check can mask the other.
      if (staticKey && presented && secretEquals(presented, staticKey)) {
        warnStaticKeyOnce();
        return null;
      }

      if (!verifier) {
        return json({ error: "invalid or missing x-api-key" }, 401);
      }

      if (schemaReady) await schemaReady;
      const decision = await verifier.authenticate(req.headers, {
        method,
        path,
        requiredScopes: [requiredScopeFor(method)],
      });
      if (decision.ok) return null;
      return json({ error: decision.message, reason: decision.reason }, decision.status);
    },
  };
}
