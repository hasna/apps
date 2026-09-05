/** Token wire-format version. Bump only on a breaking format change. */
export declare const API_KEY_TOKEN_VERSION = 1;
/** Literal token namespace prefix. */
export declare const API_KEY_NAMESPACE = "hasna";
/** App slug grammar shared by the token prefix and claims. */
export declare const APP_SLUG_PATTERN: RegExp;
/**
 * Full-token structural matcher: `hasna_<app>_<body>.<sig>`.
 *
 * Exported because the public-manifest guard in `src/conformance.ts` needs to
 * recognise a leaked key, and a second hand-written approximation of this
 * grammar is how that guard came to flag `HASNA_LOOPS_DATABASE_URL` — the env
 * name CONTRACT.md section 3 requires — as a credential.
 */
export declare const API_KEY_TOKEN_PATTERN: RegExp;
/** Default TTL applied when a caller does not specify one: 90 days. */
export declare const DEFAULT_API_KEY_TTL_SECONDS: number;
export interface ApiKeyClaims {
    /** Token format version. */
    v: number;
    /** Key id — stable identifier used for revocation and record lookup. */
    kid: string;
    /** App slug the key authenticates against. */
    app: string;
    /**
     * Tenant (organization) the key acts for, in the issuer's namespace.
     *
     * OPTIONAL AND ADDITIVE. Absent means the key is UNTENANTED — it names no
     * organization. Absent is NOT a wildcard: a service that scopes data by
     * tenant must reject an untenanted key rather than treat it as "all
     * tenants". Pass `requireTenant` to {@link verifyApiKeyToken} to get that
     * rejection from the kit instead of hand-rolling it per service.
     *
     * The value is inside the signed body, so it is tamper-evident: changing
     * `tid` invalidates the signature.
     */
    tid?: string;
    /** Granted scopes (`<app>:<action>` or wildcards). */
    scopes: string[];
    /** Issued-at, epoch seconds. */
    iat: number;
    /** Expiry, epoch seconds; `null` means the key never expires. */
    exp: number | null;
    /** Optional issued-to agent/subject (informational). */
    agent?: string;
}
/**
 * Read the `agent` claim as an OWN, string-valued property — the single guard
 * for this claim, and the sibling of `ownTenantId`.
 *
 * A claims object is either `JSON.parse` output (verification) or a locally
 * built object literal (minting). Both have `Object.prototype` in their chain,
 * so a bare `claims.agent` on a token that carries no agent resolves to
 * whatever a `__proto__`/`constructor.prototype` write primitive elsewhere in
 * the process planted there. That value is not in the signed body, so it is not
 * authentic, and it must never reach an audit trail, a principal, or a stored
 * key record as if it were.
 *
 * A missing claim is `null` — authenticated, and naming no subject. That is a
 * different fact from "never established", which callers express by omitting
 * the field entirely rather than by calling this.
 */
export declare function ownAgentClaim(source: {
    agent?: unknown;
}): string | null;
/**
 * Read the `scopes` claim as an OWN, array-valued property — the sibling of
 * {@link ownAgentClaim} and of `ownTenantId`, and the last claim in this file
 * that was still read straight off the prototype chain.
 *
 * `scopes` is the authorization claim, so the consequence of an inherited read
 * is not a mislabelled audit line but a grant: a single
 * `Object.prototype.scopes = ["*"]` write primitive anywhere in the process
 * hands a wildcard to every claim set that carries no own `scopes` key, and
 * `*` satisfies every `requiredScopes` check the kit performs.
 *
 * This is DEFENCE IN DEPTH, not a hole this kit leaves open, and the
 * distinction is worth stating so nobody later "simplifies" the property that
 * closes it. `mintApiKey` is the only place in this module that builds a
 * signed body; it refuses fewer than one scope and always writes `scopes` as
 * an own property, and an own property shadows the prototype. So no token this
 * kit can mint reaches the inherited read. A body that does reach it — from an
 * older minter, a sibling implementation, a hand-rolled issuance path — is a
 * malformed token, and `null` here makes the structural check say so.
 *
 * `null` for absent rather than `undefined`, matching `ownAgentClaim`: the
 * caller must handle the missing case explicitly rather than let it flow on as
 * a value that happens to be falsy.
 */
export declare function ownScopesClaim(source: {
    scopes?: unknown;
}): string[] | null;
export interface MintApiKeyOptions {
    app: string;
    scopes: string[];
    /**
     * Tenant (organization) the key acts for. Omit to mint an untenanted key —
     * the pre-`tid` behaviour, and still the correct choice for a single-org
     * deployment or an operator/bootstrap key. Validated and canonicalized by
     * `normalizeTenantId` at mint time so a malformed id can never enter a token.
     */
    tid?: string;
    /** HMAC signing secret (server-held). Never embedded in the token. */
    signingSecret: SigningSecret;
    /** Seconds until expiry. Omit for the default; pass `null` for no expiry. */
    ttlSeconds?: number | null;
    /** Optional issued-to agent/subject. */
    agent?: string;
    /** Override the generated key id (tests / deterministic reissue). */
    kid?: string;
    /** Epoch milliseconds override for deterministic issuance (tests). */
    nowMs?: number;
}
export interface MintedApiKey {
    /** The secret token — returned ONCE, never stored in plaintext. */
    token: string;
    /** Key id (also inside the claims). */
    kid: string;
    /** Decoded claims. */
    claims: ApiKeyClaims;
    /** sha256 hex digest of the full token — this is what to store at rest. */
    tokenHash: string;
    /** Human-recognizable prefix: `hasna_<app>_`. */
    prefix: string;
}
/**
 * The shapes this module accepts for an HMAC signing key: a string, or any view
 * over bytes. Deliberately Node's own `BinaryLike` minus `KeyObject`, because
 * `createHmac` — which every path here ends at — takes exactly these.
 *
 * STRING SECRETS ARE WHITESPACE-NORMALIZED (trimmed) BEFORE KEYING. The fleet
 * provisioning pipeline stores `api-key-signing-secret` values that carry a
 * trailing newline (64 hex characters plus '\n'), and `issue-key` and every
 * fleet server trim at their env read; this layer is the convergence point that
 * makes raw and trimmed values sign and verify identically even when a caller
 * skips its own trim. Byte views are NOT normalized — they are deliberate key
 * material and their bytes are used exactly as given.
 *
 * WHY THIS IS WIDER THAN `string | Buffer`, WHICH IS WHAT IT SAID BEFORE.
 * `verifyApiKeyToken` never narrowed: it hands the secret straight to
 * `createHmac`, so a `Uint8Array` secret has always verified and still does.
 * `mintApiKey` narrowed to `Buffer.isBuffer` in #85, which left the two halves
 * of one HMAC pair disagreeing about the same key — the issuer refusing a secret
 * every verifier sharing it accepts. Measured on that PR's base `a407b78f`,
 * `Uint8Array`, `ArrayBuffer` and `DataView` secrets all minted valid tokens, so
 * the narrowing was a breaking change to real callers rather than a tidy-up of
 * inputs that already failed. `crypto.subtle` returns an `ArrayBuffer` and
 * `Buffer.prototype.subarray` returns a view, so these are ordinary shapes for
 * key material to arrive in, not pathological ones.
 */
export type SigningSecret = string | ArrayBufferView | ArrayBuffer;
/** sha256 hex of the full token — the value persisted at rest. */
export declare function hashToken(token: string): string;
/** The `hasna_<app>_` prefix for an app slug. */
export declare function apiKeyPrefix(app: string): string;
/** Generate a short, url-safe key id (default 16 hex chars = 8 random bytes). */
export declare function generateKid(bytes?: number): string;
/**
 * Mint a new API key. Returns the plaintext token (show once) alongside the
 * sha256 hash and metadata to persist. The signing secret is NEVER embedded.
 */
export declare function mintApiKey(options: MintApiKeyOptions): MintedApiKey;
export interface ParsedApiKey {
    app: string;
    body: string;
    sig: string;
    claims: ApiKeyClaims;
}
/** Structural parse (no signature check). Returns null when malformed. */
export declare function parseApiKey(token: string): ParsedApiKey | null;
export type ApiKeyVerifyFailureReason = "malformed" | "unsupported_version" | "app_mismatch" | "bad_signature" | "not_yet_valid" | "expired" | "revoked" | "insufficient_scope" | "tenant_required" | "tenant_mismatch";
export type ApiKeyVerifyResult = {
    ok: true;
    claims: ApiKeyClaims;
    kid: string;
    app: string;
    /** Canonical tenant id, or `null` for an untenanted key. */
    tid: string | null;
    /**
     * The issued-to agent/subject, or `null` when the token claims none.
     *
     * ALWAYS present on success, which is the point: callers read this
     * instead of reaching back into `claims`. `claims` is `JSON.parse`
     * output, so a plain `claims.agent` read walks the prototype chain and,
     * in a process whose `Object.prototype` has been polluted, yields a
     * subject the signature never covered. Reading it here is an own-property
     * read of a value that was guarded once, at the single site below.
     */
    agent: string | null;
} | {
    ok: false;
    reason: ApiKeyVerifyFailureReason;
    message: string;
    /**
     * Key id and tenant, when the failure path already exposes them for audit.
     */
    kid?: string;
    tid?: string | null;
    /**
     * Agent is populated once the SIGNATURE has verified, so every
     * authenticated denial can name its subject. Absent before authenticity
     * is established because nothing in an unverified token may be believed.
     */
    agent?: string | null;
};
export interface VerifyApiKeyTokenOptions {
    /**
     * HMAC signing secret. Same {@link SigningSecret} shapes as `mintApiKey`, and
     * the type is written out here because it was previously narrower than what
     * this function actually accepted — it has always passed the value straight to
     * `createHmac`, so a `Uint8Array` secret verified while the declared type said
     * it could not. That is now stated rather than tolerated.
     */
    signingSecret: SigningSecret;
    /** Restrict verification to a single app slug (recommended per-service). */
    expectedApp?: string;
    /** Epoch milliseconds override for deterministic checks (tests). */
    nowMs?: number;
    /** Clock-skew leeway in seconds applied to iat/exp. Default 0. */
    leewaySeconds?: number;
    /** Concrete `app:action` scopes ALL of which must be granted. */
    requiredScopes?: readonly string[];
    /**
     * Reject untenanted tokens. Set this in any service whose data is scoped by
     * organization: without it, a pre-`tid` token authenticates and the caller is
     * left to remember the tenant check itself.
     */
    requireTenant?: boolean;
    /**
     * Restrict verification to one tenant. Implies {@link requireTenant}.
     * Compared with `tenantIdsEqual`, so a `uuid`-column tenant and a `text`-column
     * tenant holding the same UUID match regardless of case.
     */
    expectedTid?: string;
}
/**
 * Fully verify a token's authenticity, TTL, app binding, tenant, and
 * (optionally) scopes. Stateless — no revocation lookup. Layer revocation on
 * top via the store/middleware. Constant-time on the signature comparison.
 */
export declare function verifyApiKeyToken(token: string, options: VerifyApiKeyTokenOptions): ApiKeyVerifyResult;
