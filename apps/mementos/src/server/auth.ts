/**
 * mementos-serve API-key authentication.
 *
 * Uses the Foundation `@hasna/contracts/auth` stateless HMAC-signed verifiable
 * tokens (prefix `hasna_mementos_`). Tokens are verified cryptographically with
 * no per-request DB round-trip for authenticity; a DB-backed {@link ApiKeyStore}
 * layers revocation on top (idempotent `api_keys` table in the same cloud DB).
 *
 * Signing secret resolution (first wins):
 *   API_KEY_SIGNING_SECRET            (injected by the hasna-app Terraform module)
 *   HASNA_MEMENTOS_API_SIGNING_KEY    (per-app convention)
 *   HASNA_API_SIGNING_KEY             (shared fallback)
 *
 * When no signing secret is configured the contracts verifier is disabled and
 * the server falls back to the legacy static bearer check (`HASNA_MEMENTOS_API_KEY`,
 * legacy alias `MEMENTOS_API_KEY`) for local/dev. When neither is set, state-changing requests are REFUSED
 * (fail-closed default); an operator may explicitly restore unauthenticated
 * writes with `MEMENTOS_ALLOW_UNAUTHENTICATED_WRITES=1`. Read routes stay open
 * (local default).
 */
import pg from "pg";
import {
  verifyApiKey,
  ApiKeyStore,
  type ApiKeyVerifier,
  type AuthQueryClient,
} from "@hasna/contracts/auth";
import { getStorageConnectionString, makePool } from "../storage.js";
import { env } from "../lib/env.js";
import { authenticateRequest, isStateChangingMethod, json } from "./helpers.js";

const APP = "mementos";

let _verifier: ApiKeyVerifier | null | undefined; // undefined = uninitialized, null = disabled
let _store: ApiKeyStore | null = null;
let _schemaReady: Promise<void> | null = null;

/**
 * Requests whose API key was verified by {@link checkApiKey}. Marked so the
 * Origin/Host allowlist (an ambient-credential CSRF defense) can exempt them:
 * a request carrying a verified explicit API key and no Origin header is not
 * CSRF — see helpers.ts `checkWriteOriginOrHost`. Keyed on the Request object
 * so concurrent requests never share auth state.
 */
const AUTHENTICATED = new WeakMap<Request, boolean>();

function markAuthenticated(req: Request): void {
  AUTHENTICATED.set(req, true);
}

/** True when {@link checkApiKey} verified an explicit API key on this request. */
export function isAuthenticated(req: Request): boolean {
  return AUTHENTICATED.get(req) ?? false;
}

function signingSecret(): string | undefined {
  return (
    process.env["API_KEY_SIGNING_SECRET"]?.trim() ||
    process.env["HASNA_MEMENTOS_API_SIGNING_KEY"]?.trim() ||
    process.env["HASNA_API_SIGNING_KEY"]?.trim() ||
    undefined
  );
}

/** Minimal AuthQueryClient over a pg Pool (revocation store). */
function makeAuthClient(): AuthQueryClient | null {
  let dsn: string;
  try {
    dsn = getStorageConnectionString(APP);
  } catch {
    return null; // no cloud DB configured — verify statelessly (no revocation)
  }
  let pool: pg.Pool;
  try {
    pool = makePool(dsn);
  } catch {
    return null;
  }
  return {
    many: async (sql, params = []) => (await pool.query(sql, params as unknown[])).rows,
    get: async (sql, params = []) => (await pool.query(sql, params as unknown[])).rows[0] ?? null,
    execute: async (sql, params = []) => {
      await pool.query(sql, params as unknown[]);
    },
  };
}

/** Lazily build the contracts verifier. Returns null when auth is disabled. */
export function getApiKeyVerifier(): ApiKeyVerifier | null {
  if (_verifier !== undefined) return _verifier;

  const secret = signingSecret();
  if (!secret) {
    _verifier = null;
    return null;
  }

  const client = makeAuthClient();
  if (client) {
    _store = new ApiKeyStore(client);
    // Idempotently ensure the api_keys table exists; best-effort so a transient
    // DB hiccup never wedges startup. Stateless verification still holds.
    _schemaReady = _store.ensureSchema().catch((e) => {
      console.warn(`[mementos-serve] api_keys ensureSchema failed: ${e instanceof Error ? e.message : e}`);
    });
  }

  _verifier = verifyApiKey({
    app: APP,
    signingSecret: secret,
    keyStatus: _store ? _store.keyStatus : undefined,
    // Without a revocation store there is nothing to revoke against — the
    // contracts verifier refuses to be constructed without a key-status hook
    // (or this explicit declaration), which would 500 EVERY request on a
    // signing-secret server with no DB. The declaration applies only when no
    // store exists; with a store, `keyStatus` above carries the real
    // revocation check and this flag is irrelevant.
    allowUnregisteredKeys: _store ? undefined : true,
    audit: (e) => {
      if (e.outcome === "deny") {
        console.warn(
          `[mementos-serve] auth deny kid=${e.kid ?? "-"} reason=${e.reason} ${e.method ?? ""} ${e.path ?? ""}`
        );
      }
    },
  });
  return _verifier;
}

/**
 * Gate a request. Returns an error `Response` to reject, or `null` to allow.
 * `requiredScopes` (optional) enforces per-mount scope requirements.
 */
export async function checkApiKey(
  req: Request,
  method: string,
  path: string,
  requiredScopes?: readonly string[]
): Promise<Response | null> {
  const verifier = getApiKeyVerifier();
  if (!verifier) {
    // Contracts auth disabled. Fail closed on state-changing requests when no
    // API key is configured: with neither a signing secret nor a static key,
    // mutations are refused unless the operator explicitly opted in.
    if (isStateChangingMethod(method) && !unauthenticatedWritesAllowed()) {
      return json(
        { error: "Unauthorized. No API key is configured; state-changing requests are refused." },
        401
      );
    }
    // Fall back to the legacy static bearer check (reads, or opted-in writes).
    const authError = authenticateRequest(req);
    if (authError) return authError;
    // A static bearer key was configured AND matched — an explicit credential,
    // so the request is not CSRF (see isAuthenticated / checkWriteOriginOrHost).
    if (env.apiKey()) markAuthenticated(req);
    return null;
  }
  if (_schemaReady) await _schemaReady;
  const decision = await verifier.authenticate(req.headers, { method, path, requiredScopes });
  if (!decision.ok) return json({ error: decision.message, reason: decision.reason }, decision.status);
  markAuthenticated(req);
  return null;
}

/** True when contracts API-key auth is active (a signing secret is configured). */
export function apiKeyAuthEnabled(): boolean {
  return getApiKeyVerifier() !== null;
}

/**
 * Explicit operator opt-in for unauthenticated writes.
 *
 * The fail-closed default refuses state-changing requests when no API key is
 * configured; a local deployment that deliberately runs without a key sets
 * `MEMENTOS_ALLOW_UNAUTHENTICATED_WRITES=1` to restore the old allow-all
 * behaviour for mutations. Absence is never treated as consent.
 */
function unauthenticatedWritesAllowed(): boolean {
  const raw = process.env["MEMENTOS_ALLOW_UNAUTHENTICATED_WRITES"]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
