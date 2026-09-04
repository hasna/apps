// Operator-only key lifecycle routes for the serve kit: mint, list, revoke.
//
// WHY THIS EXISTS (hasna/apps#1595). A hosted service is unusable from a
// station until a CLIENT key exists for it, and until now the only way to make
// one was `contracts issue-key` with the app's signing secret AND its owner
// Postgres URL — reachable only from inside the VPC. So key provisioning was a
// manual, in-VPC ceremony that deploys did not perform: `messages-prod` served
// traffic with no key in existence, `hooks`, `skills`, `emails` and `notes` all
// went days without one, and `projects` and `knowledge` shipped keys that had
// been REVOKED at the origin while the stored copy still held the dead value.
// Nothing could detect that last case, because nothing outside the database
// could ask the service about its own keys.
//
// These routes make key lifecycle part of the service, so a deploy lane (and a
// daily drift check) can provision and verify a key over HTTPS with no database
// URL and no signing secret of its own.
//
// THE GATE. Every route requires an authenticated key for THIS app carrying the
// operator scope — `<app>:keys.admin` by default, which a bootstrap key
// (`<app>:*`) satisfies and an ordinary client key (`<app>:read`,
// `<app>:write`) does not. The gate is `verifyApiKey`, the same verifier that
// guards every other route, so revocation, expiry, tenancy and the audit hook
// all behave identically here. There is no second, weaker authentication path
// into key issuance — that would be the most valuable route in the service to
// find one on.
//
// WHAT IS AND IS NOT RETURNED. Minting returns the plaintext token EXACTLY
// ONCE, in the response to the request that created it; it is never logged,
// never re-readable, and only its sha256 is persisted. Listing returns metadata
// only — never `token_hash`, because a hash is an offline verification oracle
// for a guessed token and an operator listing keys has no use for one.
//
// FRAMEWORK-AGNOSTIC, like `verifyApiKey`. It takes a plain
// method/path/headers/body request and returns a status/body pair, so Express,
// Hono, and `Bun.serve` mount it in three lines without this package taking a
// framework dependency.

import { hasScope, isValidScope } from "./scopes.js";
import { mintApiKey, type MintedApiKey } from "./keys.js";
import { normalizeTenantId } from "./tenant.js";
import type { ApiKeyRecord, ApiKeyStatus } from "./store.js";
import {
  verifyApiKey,
  type AuthAuditHook,
  type HeaderSource,
  type KeyStatusResolver,
} from "./middleware.js";

/** Default mount point. `/v1` because that is the only versioned root a Hasna service serves. */
export const KEY_LIFECYCLE_BASE_PATH = "/v1/admin/keys";

/** The action half of the operator scope. */
export const KEY_LIFECYCLE_SCOPE_ACTION = "keys.admin";

/** The operator scope a caller must hold to use these routes. */
export function keyLifecycleScope(app: string): string {
  return `${app}:${KEY_LIFECYCLE_SCOPE_ACTION}`;
}

/** Default lifetime for a minted client key, in days. */
export const DEFAULT_CLIENT_KEY_TTL_DAYS = 365;

/**
 * The store operations these routes need — the structural subset of
 * {@link ApiKeyStore} they use, so a test shim or a narrower wrapper works.
 */
export interface KeyLifecycleStore {
  insertMinted(minted: MintedApiKey, createdBy?: string): Promise<void>;
  list(options?: { app?: string; tid?: string; includeRevoked?: boolean }): Promise<ApiKeyRecord[]>;
  revoke(kid: string, reason?: string, atMs?: number): Promise<boolean>;
  findByKid?(kid: string): Promise<ApiKeyRecord | null>;
}

export interface KeyLifecycleRouteOptions {
  /** App slug this service authenticates and mints for. */
  app: string;
  /**
   * HMAC signing secret. A string is trimmed on use, like every other reader
   * (see ./signing-secret.ts). Typed as the verifier types it, because these
   * routes mint AND verify with the same secret and the two must not drift.
   */
  signingSecret: string | Buffer;
  /** Where the hashed records live. */
  store: KeyLifecycleStore;
  /**
   * Lifecycle lookup for the PRESENTED operator key. Wire `store.keyStatus`.
   * Required for the same reason `verifyApiKey` requires it: without it a
   * revoked operator key still mints new keys.
   */
  keyStatus?: KeyStatusResolver;
  /** Explicit, greppable opt-out of the above. See `verifyApiKey`. */
  allowUnregisteredKeys?: boolean;
  /** Mount point. Default {@link KEY_LIFECYCLE_BASE_PATH}. */
  basePath?: string;
  /** Operator scope. Default {@link keyLifecycleScope}. */
  operatorScope?: string;
  /** Per-request audit hook, shared with the rest of the service. */
  audit?: AuthAuditHook;
  /** Epoch-ms clock override (tests). */
  nowMs?: () => number;
  /** Upper bound on a minted key's lifetime, in days. Default 365. */
  maxTtlDays?: number;
}

/** A framework-neutral request. `path` may carry a query string. */
export interface KeyLifecycleRequest {
  method: string;
  path: string;
  headers: HeaderSource;
  /** Parsed JSON object, or the raw JSON text. */
  body?: unknown;
}

/** A framework-neutral response. `body` is always a JSON object. */
export interface KeyLifecycleResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface KeyLifecycleRouter {
  /** Mount point these routes answer under. */
  basePath: string;
  /** The scope a caller must hold. */
  operatorScope: string;
  /** True when a path belongs to this router (query string tolerated). */
  matches(path: string): boolean;
  /** Handle one request. Never throws; failures are status/body pairs. */
  handle(request: KeyLifecycleRequest): Promise<KeyLifecycleResponse>;
}

/**
 * Own-property read for a caller-supplied bag.
 *
 * Same reason as `ownOption` in ./middleware.ts, and it matters more here: these
 * values land INSIDE a signed token, so a `scopes` or `tid` resolved through a
 * polluted prototype would be cryptographically authentic and no verifier could
 * refuse it afterwards. A JSON body parsed by `JSON.parse` has
 * `Object.prototype` in its chain like any other object.
 */
function ownField(bag: unknown, name: string): unknown {
  if (typeof bag !== "object" || bag === null) return undefined;
  return Object.hasOwn(bag as Record<string, unknown>, name)
    ? (bag as Record<string, unknown>)[name]
    : undefined;
}

function fail(status: number, reason: string, message: string): KeyLifecycleResponse {
  return { status, body: { error: message, reason } };
}

/** Records are returned WITHOUT `token_hash` — see the header comment. */
function publicRecord(record: ApiKeyRecord, nowMs: number): Record<string, unknown> {
  return {
    kid: record.kid,
    app: record.app,
    agent: record.agent,
    tid: record.tid,
    scopes: record.scopes,
    issued_at: record.issuedAt,
    expires_at: record.expiresAt,
    revoked_at: record.revokedAt,
    revoked_reason: record.revokedReason,
    last_used_at: record.lastUsedAt,
    created_by: record.createdBy,
    status: recordStatus(record, nowMs),
  };
}

function recordStatus(record: ApiKeyRecord, nowMs: number): ApiKeyStatus {
  if (record.revokedAt) return "revoked";
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= nowMs) return "expired";
  return "active";
}

function parseBody(body: unknown): Record<string, unknown> | null {
  if (body === undefined || body === null || body === "") return {};
  if (typeof body === "string") {
    try {
      const parsed: unknown = JSON.parse(body);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  return null;
}

/**
 * Create the operator-only key lifecycle router.
 *
 * Routes, relative to `basePath`:
 *
 *   POST   ``                mint a client key -> 201 `{ key, kid, ... }` (key shown once)
 *   GET    ``                list keys         -> 200 `{ keys: [...] }` (metadata only)
 *   GET    `/<kid>`          one key           -> 200 `{ key: {...} }` / 404
 *   DELETE `/<kid>`          revoke            -> 200 `{ kid, revoked }` / 404
 *   POST   `/<kid>/revoke`   revoke            -> same as DELETE
 */
export function createKeyLifecycleRoutes(options: KeyLifecycleRouteOptions): KeyLifecycleRouter {
  const app = options.app;
  if (!/^[a-z][a-z0-9-]*$/.test(app)) {
    throw new Error(`Invalid app slug '${app}'. Expected a lowercase DNS-style slug.`);
  }
  const basePath = (options.basePath ?? KEY_LIFECYCLE_BASE_PATH).replace(/\/+$/, "");
  if (!basePath.startsWith("/")) {
    throw new Error("Key lifecycle basePath must be an absolute path.");
  }
  const operatorScope = options.operatorScope ?? keyLifecycleScope(app);
  const maxTtlDays = options.maxTtlDays ?? DEFAULT_CLIENT_KEY_TTL_DAYS;
  if (!Number.isFinite(maxTtlDays) || maxTtlDays <= 0) {
    throw new Error("maxTtlDays must be a positive number.");
  }
  const clock = options.nowMs ?? Date.now;

  // The gate is constructed ONCE, at mount time, so its own fail-closed checks
  // (a missing key-status hook, a conflicting revocation wiring) throw at boot
  // rather than on the first provisioning request.
  const verifier = verifyApiKey({
    app,
    signingSecret: options.signingSecret,
    requiredScopes: [operatorScope],
    ...(options.keyStatus !== undefined ? { keyStatus: options.keyStatus } : {}),
    ...(options.allowUnregisteredKeys !== undefined
      ? { allowUnregisteredKeys: options.allowUnregisteredKeys }
      : {}),
    ...(options.audit !== undefined ? { audit: options.audit } : {}),
    ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
  });

  function routePath(path: string): string {
    // A framework may hand us a full URL or a path with a query string; the
    // route decision must be made on the PATH alone.
    const withoutQuery = path.split(/[?#]/, 1)[0] ?? "";
    return withoutQuery.replace(/\/+$/, "") || "/";
  }

  function matches(path: string): boolean {
    const resolved = routePath(path);
    return resolved === basePath || resolved.startsWith(`${basePath}/`);
  }

  function subPath(path: string): string {
    const resolved = routePath(path);
    return resolved === basePath ? "" : resolved.slice(basePath.length);
  }

  async function mint(body: Record<string, unknown>, createdBy: string): Promise<KeyLifecycleResponse> {
    const rawAgent = ownField(body, "agent");
    if (typeof rawAgent !== "string" || rawAgent.trim().length === 0) {
      return fail(400, "invalid_agent", "Provide 'agent': the subject this key is issued to.");
    }
    const agent = rawAgent.trim();

    const rawScopes = ownField(body, "scopes");
    const scopes =
      rawScopes === undefined ? [`${app}:read`, `${app}:write`] : rawScopes;
    if (!Array.isArray(scopes) || scopes.length === 0 || !scopes.every((s) => typeof s === "string")) {
      return fail(400, "invalid_scopes", "'scopes' must be a non-empty array of scope strings.");
    }
    for (const scope of scopes as string[]) {
      if (!isValidScope(scope)) {
        return fail(400, "invalid_scopes", `Invalid scope '${scope}'. Expected '<app>:<action>'.`);
      }
      // A key minted HERE is a key for THIS app: the token's `app` claim is
      // fixed to it, so a scope naming another app (or the `*` superuser grant)
      // could never be honoured by this service and would only mislead whoever
      // reads the key's scopes later.
      if (scope === "*" || !scope.startsWith(`${app}:`)) {
        return fail(
          400,
          "invalid_scopes",
          `Scope '${scope}' is not for app '${app}'. This route mints keys for '${app}' only.`,
        );
      }
    }

    const rawTid = ownField(body, "tid");
    let tid: string | undefined;
    if (rawTid !== undefined && rawTid !== null) {
      try {
        tid = normalizeTenantId(String(rawTid));
      } catch (error) {
        return fail(400, "invalid_tid", error instanceof Error ? error.message : "Invalid 'tid'.");
      }
    }

    // PRESENCE, not truthiness or nullishness: `ttl_days: null` MEANS "no
    // expiry", and a `??` chain here silently swallowed it into the default
    // 365-day lifetime — the request that asked for a non-expiring deploy key
    // got an expiring one, and nothing said so.
    const ttlField = Object.hasOwn(body, "ttl_days")
      ? "ttl_days"
      : Object.hasOwn(body, "ttlDays")
        ? "ttlDays"
        : null;
    const rawTtl = ttlField === null ? undefined : ownField(body, ttlField);
    let ttlSeconds: number | null;
    if (rawTtl === null) {
      ttlSeconds = null;
    } else if (rawTtl === undefined) {
      ttlSeconds = Math.floor(DEFAULT_CLIENT_KEY_TTL_DAYS * 86_400);
    } else {
      const days = Number(rawTtl);
      if (!Number.isFinite(days) || days <= 0 || days > maxTtlDays) {
        return fail(
          400,
          "invalid_ttl",
          `'ttl_days' must be a positive number no greater than ${maxTtlDays}, or null for no expiry.`,
        );
      }
      ttlSeconds = Math.floor(days * 86_400);
    }

    let minted: MintedApiKey;
    try {
      minted = mintApiKey({
        app,
        scopes: [...(scopes as string[])],
        signingSecret: options.signingSecret,
        ttlSeconds,
        agent,
        nowMs: clock(),
        ...(tid !== undefined ? { tid } : {}),
      });
    } catch (error) {
      return fail(400, "mint_failed", error instanceof Error ? error.message : "Could not mint key.");
    }

    try {
      await options.store.insertMinted(minted, createdBy);
    } catch {
      // FAIL CLOSED, and say so. A minted-but-unrecorded key cannot be revoked
      // (revocation writes to a row that does not exist) and every verifier
      // wired to `keyStatus` refuses it as `unknown_key` anyway — so returning
      // it would hand back a credential that is simultaneously useless and
      // irrevocable. The plaintext is dropped here and never leaves the process.
      return fail(
        503,
        "record_not_stored",
        "The key was minted but its record could not be stored, so it was discarded. Retry.",
      );
    }

    return {
      status: 201,
      body: {
        // Shown ONCE. Only sha256(token) is persisted; this value cannot be
        // recovered from the service afterwards.
        key: minted.token,
        kid: minted.kid,
        app,
        agent,
        tid: tid ?? null,
        scopes: [...(scopes as string[])],
        issued_at: new Date(minted.claims.iat * 1000).toISOString(),
        expires_at: minted.claims.exp === null ? null : new Date(minted.claims.exp * 1000).toISOString(),
      },
    };
  }

  async function list(path: string): Promise<KeyLifecycleResponse> {
    const query = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
    const includeRevoked = query.get("include_revoked") === "1" || query.get("include_revoked") === "true";
    const rawTid = query.get("tid");
    let records: ApiKeyRecord[];
    try {
      records = await options.store.list({
        app,
        includeRevoked,
        // PRESENCE, not truthiness: an empty `tid` filter is a caller that MEANT
        // to scope the listing, and widening it to every tenant is the
        // enumeration `ApiKeyStore.list` refuses for the same reason.
        ...(rawTid !== null ? { tid: rawTid } : {}),
      });
    } catch (error) {
      return fail(400, "invalid_filter", error instanceof Error ? error.message : "Invalid list filter.");
    }
    const now = clock();
    return { status: 200, body: { keys: records.map((record) => publicRecord(record, now)) } };
  }

  async function revoke(kid: string, body: Record<string, unknown>): Promise<KeyLifecycleResponse> {
    const rawReason = ownField(body, "reason");
    const reason = typeof rawReason === "string" && rawReason.trim() ? rawReason.trim() : "revoked_by_operator";
    const revoked = await options.store.revoke(kid, reason, clock());
    if (!revoked) return fail(404, "unknown_key", `No key with kid '${kid}' is recorded for '${app}'.`);
    return { status: 200, body: { kid, revoked: true, reason } };
  }

  async function handle(request: KeyLifecycleRequest): Promise<KeyLifecycleResponse> {
    const method = String(request.method ?? "").toUpperCase();
    const path = String(request.path ?? "");
    if (!matches(path)) return fail(404, "not_found", "No such route.");
    const rest = subPath(path).split(/[?#]/, 1)[0] ?? "";

    const decision = await verifier.authenticate(request.headers, {
      method,
      path: routePath(path),
      requiredScopes: [operatorScope],
    });
    if (!decision.ok) {
      return { status: decision.status, body: { error: decision.message, reason: decision.reason } };
    }
    // Defence in depth: `verifyApiKey` already required the operator scope, and
    // this asserts the same fact about the principal it handed back. The two
    // are one line apart on purpose — this is the route that mints credentials,
    // and a future refactor that drops `requiredScopes` from the constructor
    // must not silently open it.
    if (!hasScope(decision.principal.scopes, operatorScope)) {
      return fail(403, "insufficient_scope", `This route requires the '${operatorScope}' scope.`);
    }
    const createdBy = decision.principal.agent ?? decision.principal.kid;

    const body = parseBody(request.body);
    if (body === null) return fail(400, "invalid_body", "Request body must be a JSON object.");

    if (rest === "") {
      if (method === "POST") return mint(body, createdBy);
      if (method === "GET") return list(path);
      return fail(405, "method_not_allowed", "Use POST to mint a key or GET to list keys.");
    }

    const segments = rest.split("/").filter(Boolean);
    const kid = segments[0] ?? "";
    if (!/^[A-Za-z0-9_-]+$/.test(kid)) {
      return fail(400, "invalid_kid", "Key id must be url-safe (letters, digits, '_' or '-').");
    }

    if (segments.length === 1) {
      if (method === "DELETE") return revoke(kid, body);
      if (method === "GET") {
        if (!options.store.findByKid) {
          return fail(501, "not_implemented", "This key store cannot look a key up by kid.");
        }
        const record = await options.store.findByKid(kid);
        if (!record || record.app !== app) {
          return fail(404, "unknown_key", `No key with kid '${kid}' is recorded for '${app}'.`);
        }
        return { status: 200, body: { key: publicRecord(record, clock()) } };
      }
      return fail(405, "method_not_allowed", "Use GET to read a key or DELETE to revoke it.");
    }

    if (segments.length === 2 && segments[1] === "revoke") {
      if (method === "POST") return revoke(kid, body);
      return fail(405, "method_not_allowed", "Use POST to revoke a key.");
    }

    return fail(404, "not_found", "No such route.");
  }

  return { basePath, operatorScope, matches, handle };
}
