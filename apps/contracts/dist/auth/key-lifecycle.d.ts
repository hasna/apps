import { type MintedApiKey } from "./keys.js";
import type { ApiKeyRecord } from "./store.js";
import { type AuthAuditHook, type HeaderSource, type KeyStatusResolver } from "./middleware.js";
/** Default mount point. `/v1` because that is the only versioned root a Hasna service serves. */
export declare const KEY_LIFECYCLE_BASE_PATH = "/v1/admin/keys";
/** The action half of the operator scope. */
export declare const KEY_LIFECYCLE_SCOPE_ACTION = "keys.admin";
/** The operator scope a caller must hold to use these routes. */
export declare function keyLifecycleScope(app: string): string;
/** Default lifetime for a minted client key, in days. */
export declare const DEFAULT_CLIENT_KEY_TTL_DAYS = 365;
/**
 * The store operations these routes need — the structural subset of
 * {@link ApiKeyStore} they use, so a test shim or a narrower wrapper works.
 */
export interface KeyLifecycleStore {
    insertMinted(minted: MintedApiKey, createdBy?: string): Promise<void>;
    list(options?: {
        app?: string;
        tid?: string;
        includeRevoked?: boolean;
    }): Promise<ApiKeyRecord[]>;
    /**
     * `options.app` is passed on every revoke this router performs. A store that
     * ignores it is still SAFE here — the router establishes ownership itself
     * before calling (see `ownedByApp`), because this parameter is optional in
     * the structural type and a three-parameter shim satisfies it silently.
     */
    revoke(kid: string, reason?: string, atMs?: number, options?: {
        app?: string;
    }): Promise<boolean>;
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
export declare function createKeyLifecycleRoutes(options: KeyLifecycleRouteOptions): KeyLifecycleRouter;
