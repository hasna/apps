import { type ApiKeyClaims, type ApiKeyVerifyFailureReason } from "./keys.js";
import type { ApiKeyStatus } from "./store.js";
/**
 * Every reason a request can be refused, including the two the token verifier
 * cannot see: no credential was sent at all, and the credential is authentic
 * but names a key this service has no record of.
 */
export type AuthDenyReason = ApiKeyVerifyFailureReason | "missing_token" | "unknown_key"
/** The status lookup itself failed; the key was never judged. Deny, 503. */
 | "status_unavailable";
/**
 * Resolve a key's lifecycle status. This is the strict, RECOMMENDED hook —
 * `ApiKeyStore.keyStatus` implements it — and it is strict precisely because it
 * can say `"unknown"`. Anything other than `"active"` denies.
 */
export type KeyStatusResolver = (kid: string) => ApiKeyStatus | Promise<ApiKeyStatus>;
/** Header sources the middleware can read tokens from. */
export type HeaderSource = Headers | Record<string, string | string[] | undefined> | ((name: string) => string | null | undefined);
/** Authenticated principal attached to a request on success. */
export interface ApiKeyPrincipal {
    kid: string;
    app: string;
    scopes: string[];
    agent: string | null;
    /**
     * Canonical tenant id, or `null` when the key is untenanted. Handlers that
     * scope data by organization read this instead of digging into `claims`.
     * `null` here means "no tenant claimed" — never "every tenant".
     */
    tid: string | null;
    claims: ApiKeyClaims;
}
export interface AuthAuditEvent {
    outcome: "allow" | "deny";
    app: string;
    kid: string | null;
    /**
     * Tenant the request authenticated as, or `null` when the key is untenanted
     * or the request never got far enough to establish one. Present so an audit
     * trail can answer "which organization did this" without re-parsing tokens.
     */
    tid: string | null;
    /**
     * The key's issued-to agent/subject, so an audit trail can answer "WHO did
     * this" without a second lookup. Without it the only route from a log line to
     * an agent is `kid` in the log then `SELECT agent FROM api_keys WHERE kid`,
     * which needs database access at log-read time — exactly when you least have
     * it.
     *
     * Three-state, and the distinction is deliberate:
     *   `undefined` — never established, because the request was refused BEFORE
     *                 the signature verified. Nothing in an unverified token may
     *                 be believed, so no value is reported rather than a wrong one.
     *   `null`      — established, and the key carries no `agent` claim.
     *   a string    — the claim, which is authentic: `agent` lives inside the
     *                 signed body, so altering it invalidates the signature.
     *
     * Optional rather than required because services construct this object
     * themselves — `emails` and `mailery` each build an `AuthAuditEvent`
     * literal inside their own API-key verifier — and a required field would break
     * their type-check on upgrade.
     */
    agent?: string | null;
    reason: AuthDenyReason | null;
    scopesRequired: string[];
    method: string | null;
    path: string | null;
    status: number;
    at: string;
}
export type AuthAuditHook = (event: AuthAuditEvent) => void | Promise<void>;
export type AuthDecision = {
    ok: true;
    status: 200;
    principal: ApiKeyPrincipal;
} | {
    ok: false;
    status: 401 | 403 | 503;
    reason: AuthDenyReason;
    message: string;
};
export interface ApiKeyAuthContext {
    method?: string | null;
    path?: string | null;
    /** Concrete `app:action` scopes ALL of which must be granted for this call. */
    requiredScopes?: readonly string[];
    /**
     * Tenant this specific call must belong to — for routes that address an
     * organization directly (`/v1/orgs/:tid/...`). Denies with `tenant_mismatch`
     * when the token names a different tenant, and with `tenant_required` when it
     * names none. A malformed value denies rather than throwing, because it can
     * come from a request path.
     *
     * Only OMITTING the key means "no per-call expectation". Supplying one that
     * did not resolve — `null`, `""`, an Express multi-value array — is a denial,
     * never a fallback to the middleware-wide setting and never a wildcard.
     */
    expectedTid?: string;
}
export interface VerifyApiKeyOptions {
    /** App slug this service authenticates (tokens for other apps are rejected). */
    app: string;
    /** HMAC signing secret (server-held). Required — no insecure default. */
    signingSecret: string | Buffer;
    /**
     * Lifecycle lookup for the presented key — the RECOMMENDED hook. Wire
     * `store.keyStatus`. Anything other than `"active"` denies, including
     * `"unknown"`, so a token this service has no record of cannot authenticate.
     *
     * Prefer this over {@link isRevoked} in every service. A boolean predicate
     * cannot distinguish "known and fine" from "never heard of it", and that
     * ambiguity is the whole defect: it resolved to ALLOW.
     */
    keyStatus?: KeyStatusResolver;
    /**
     * Revocation check: return true to DENY.
     *
     * @deprecated Lossy. Returns `false` both for an active key and for a key
     * with no record at all, so it cannot refuse an unregistered kid. Supplying
     * it now requires {@link allowUnregisteredKeys}, which makes the residual
     * risk explicit and greppable. Use {@link keyStatus} instead.
     */
    isRevoked?: (kid: string) => boolean | Promise<boolean>;
    /**
     * Accept keys this service has no record of. **Unsafe, and deliberately
     * awkward to type.**
     *
     * Defaults to `false`: a verifier must be able to refuse an unregistered kid,
     * or say in its own source that it cannot. Set this only while a service is
     * still migrating to registered keys — a key with no row cannot be revoked,
     * because revocation writes `revoked_at` to a row that does not exist.
     *
     * Combines with {@link keyStatus}: unknown kids are tolerated, revoked and
     * expired ones are still refused.
     */
    allowUnregisteredKeys?: boolean;
    /** Per-request audit hook. Fires on every allow and deny. */
    audit?: AuthAuditHook;
    /** Scopes required for every request this middleware guards. */
    requiredScopes?: readonly string[];
    /**
     * Reject untenanted keys for every request this middleware guards. Turn this
     * on in any service whose rows carry an organization reference — otherwise a
     * pre-`tid` key authenticates with no organization and the tenant check has
     * to be remembered in every handler.
     */
    requireTenant?: boolean;
    /**
     * Pin the whole middleware to one tenant. Implies {@link requireTenant}.
     * Validated eagerly: an invalid value throws at construction rather than
     * denying every request at runtime.
     */
    expectedTid?: string;
    /** Custom header for the raw key. Default `x-api-key`. */
    headerName?: string;
    /** Authorization scheme also accepted. Default `Bearer`. */
    scheme?: string;
    /** Clock-skew leeway (seconds) for iat/exp. Default 0. */
    leewaySeconds?: number;
    /** Epoch-ms clock override (tests). */
    nowMs?: () => number;
}
/** Extract the raw token from `x-api-key` or `Authorization: <scheme> <token>`. */
export declare function extractToken(source: HeaderSource, headerName?: string, scheme?: string): string | null;
export interface ApiKeyVerifier {
    /**
     * Authenticate a request from its headers. Never throws — every failure,
     * including an unavailable status lookup, comes back as a deny decision.
     */
    authenticate(headers: HeaderSource, context?: ApiKeyAuthContext): Promise<AuthDecision>;
    readonly app: string;
}
/**
 * Build the framework-agnostic verifier. This is the primary entry point the
 * serve services call; `expressApiKey`/`honoApiKey` are thin wrappers over it.
 */
export declare function verifyApiKey(options: VerifyApiKeyOptions): ApiKeyVerifier;
/**
 * Express middleware. On success sets `req.apiKey` (the principal) and calls
 * `next()`. On failure responds `{ error, reason }` with the right status.
 */
export declare function expressApiKey(options: VerifyApiKeyOptions): (req: any, res: any, next: any) => Promise<void>;
/**
 * Hono middleware. On success sets `c.set("apiKey", principal)` and awaits
 * `next()`. On failure returns a JSON error with the right status.
 */
export declare function honoApiKey(options: VerifyApiKeyOptions): (c: any, next: any) => Promise<unknown>;
