/** The only signature algorithm this seam accepts. */
export declare const FLEET_TOKEN_ALG = "EdDSA";
/** The `typ` header the reference issuer stamps on access tokens. */
export declare const FLEET_TOKEN_TYP = "at+jwt";
/**
 * Ceiling on a fleet token's lifetime. Offline verification cannot see a
 * revocation, so the token's TTL *is* the revocation window. 24h matches the
 * reference issuer's own server-side clamp.
 */
export declare const MAX_FLEET_TOKEN_TTL_SECONDS: number;
/**
 * Ceiling on clock-skew leeway.
 *
 * Leeway extends the window in which an expired token is still accepted, and
 * offline verification cannot see a revocation — so leeway is added directly to
 * the revocation window this module spends the rest of its length defending. An
 * unbounded value quietly undoes that: `..._LEEWAY_SECONDS=300000` instead of
 * `300` is one keystroke and buys three and a half days of accepting revoked
 * tokens. Five minutes is far more than any sane fleet needs for NTP drift.
 */
export declare const MAX_FLEET_TOKEN_LEEWAY_SECONDS = 300;
/** Principal type carried in the `pt` claim. */
export declare const PRINCIPAL_TYPES: readonly ["user", "service"];
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];
/** A published Ed25519 verification key. Public material only. */
export interface Ed25519PublicJwk {
    kty: "OKP";
    crv: "Ed25519";
    /** base64url-encoded public key. */
    x: string;
    kid: string;
    use?: "sig";
    alg?: "EdDSA";
}
/** A JWKS document holding one or more Ed25519 verification keys. */
export interface FleetJwks {
    keys: Ed25519PublicJwk[];
}
/** Claims carried by a fleet access token. */
export interface FleetTokenClaims {
    /** Issuer — an opaque wire-contract string, NOT necessarily a URL. */
    iss: string;
    /** Audience — the app slug the token is for. Accepts a JWT array form too. */
    aud: string | string[];
    /** Subject — the principal id in the issuer's namespace. */
    sub: string;
    /** Tenant/organization. Required: the identity seam is tenant-native. */
    tid: string;
    /** Principal type. */
    pt: PrincipalType;
    /** Granted scopes, in the same `<app>:<action>` grammar as API keys. */
    scope: string[];
    /** Issued-at, epoch seconds. */
    iat: number;
    /** Expiry, epoch seconds. Required. */
    exp: number;
    /** Not-before, epoch seconds. Optional. */
    nbf?: number;
    /** Token id — the handle any revocation list is keyed by. Required. */
    jti: string;
}
export type FleetJwksProblem = "not_an_object" | "keys_not_an_array" | "empty_key_set" | "no_usable_key" | "private_material";
export type ParseFleetJwksResult = {
    ok: true;
    jwks: FleetJwks;
} | {
    ok: false;
    problem: FleetJwksProblem;
    message: string;
};
/**
 * Validate an untrusted JWKS document — the JSON an operator loaded from a
 * file, an env var, or their own out-of-band refresh.
 *
 * Fails on an empty or all-unusable key set rather than returning one: a
 * verifier holding zero keys rejects everything, which is correct but produces
 * a per-request failure that looks like a token problem. Surfacing it here
 * makes it a startup problem, which is what it is.
 */
export declare function parseFleetJwks(value: unknown): ParseFleetJwksResult;
export type IdentityVerifyFailureReason = "malformed" | "unsupported_alg" | "unsupported_typ" | "missing_kid" | "unknown_kid" | "no_usable_key" | "bad_signature" | "unsupported_crit" | "private_material" | "issuer_mismatch" | "audience_mismatch" | "missing_expiry" | "excessive_ttl" | "expired" | "not_yet_valid" | "invalid_claims" | "tenant_mismatch" | "revoked" | "insufficient_scope";
/** An authenticated fleet principal. Field names mirror `ApiKeyPrincipal`. */
export interface IdentityPrincipal {
    /** Principal id in the issuer's namespace. */
    sub: string;
    /** Canonical tenant id — the value a service maps onto its own org. */
    tid: string;
    principalType: PrincipalType;
    /** Granted scopes. Same name and grammar as `ApiKeyPrincipal.scopes`. */
    scopes: string[];
    /** Token id — the revocation handle. */
    jti: string;
    /** Key id the signature verified against. */
    kid: string;
    issuer: string;
    audience: string;
    /** Expiry as an ISO timestamp, for logging and audit. */
    expiresAt: string;
    claims: FleetTokenClaims;
}
export type IdentityVerifyResult = {
    ok: true;
    principal: IdentityPrincipal;
} | {
    ok: false;
    reason: IdentityVerifyFailureReason;
    message: string;
};
export interface VerifyFleetTokenOptions {
    /**
     * The verification key set — a VALUE, never a URI. This is what makes
     * offline verification structural: there is no code path here that could
     * fetch it.
     */
    jwks: FleetJwks;
    /** Expected `iss`. Required — an unpinned issuer accepts anyone's tokens. */
    issuer: string;
    /** Expected `aud` (this app's slug). Required. */
    audience: string;
    /** Epoch-ms clock override (tests). */
    nowMs?: number;
    /** Clock-skew leeway in seconds. Default 0. */
    leewaySeconds?: number;
    /** Restrict to one tenant, compared with `tenantIdsEqual`. */
    expectedTid?: string;
    /** Concrete `app:action` scopes ALL of which must be granted. */
    requiredScopes?: readonly string[];
    /** Reject tokens whose lifetime exceeds this. Default 24h. */
    maxTtlSeconds?: number;
}
/** Upper bound on `sub` and `jti`. Generous for a UUID, ULID, or prefixed id. */
export declare const MAX_IDENTIFIER_LENGTH = 255;
/**
 * Fully verify a fleet access token offline: header, signature, issuer,
 * audience, lifetime, tenant, and (optionally) scopes.
 *
 * Order is deliberate. The header is checked and the algorithm pinned BEFORE
 * any key is loaded, so an attacker-chosen `alg` never selects a code path.
 * The signature is checked before any claim is trusted. Tenant is checked
 * before scopes, so a wrong-organization token is never reported as merely
 * under-scoped.
 */
export declare function verifyFleetToken(token: string, options: VerifyFleetTokenOptions): IdentityVerifyResult;
/**
 * How a service hands the verifier its key set. Async so an operator may back
 * it with a cache they refresh out of band; the kit never triggers a refresh
 * and never fetches. Returning a stale-but-valid key set is the operator's
 * call, and is exactly what "offline" means here.
 */
export type JwksSource = () => FleetJwks | Promise<FleetJwks>;
export interface IdentityProviderConfig {
    /** Expected `iss`. An opaque wire-contract string, not necessarily a URL. */
    issuer: string;
    /** Expected `aud` — this app's slug. */
    audience: string;
    /**
     * Where the operator's own refresher fetches the key set. RECORDED ONLY —
     * nothing in this module dereferences it.
     */
    jwksUri: string | null;
    leewaySeconds: number;
    maxTtlSeconds: number;
}
export interface IdentityVerifierOptions {
    /**
     * Revocation check keyed by `jti`: return true to DENY. Offline
     * verification cannot see a revocation on its own, so a service that needs
     * one supplies it here — the same shape as the API-key middleware's
     * `isRevoked(kid)`.
     */
    isRevoked?: (jti: string) => boolean | Promise<boolean>;
}
export interface IdentityAuthContext {
    expectedTid?: string;
    requiredScopes?: readonly string[];
}
export interface IdentityVerifier {
    verify(token: string, context?: IdentityAuthContext): Promise<IdentityVerifyResult>;
    readonly config: IdentityProviderConfig;
}
/**
 * Build the identity verifier a server mounts alongside — never instead of —
 * its in-repo API-key default.
 */
export declare function createIdentityVerifier(config: IdentityProviderConfig, jwksSource: JwksSource, options?: IdentityVerifierOptions): IdentityVerifier;
/**
 * The `tid` -> org half of the seam. The token names a tenant in the ISSUER's
 * namespace; the service resolves it to one of its OWN organization rows. The
 * resolver returning `null` means "this issuer's tenant is not provisioned
 * here", which must DENY — a service that silently invents an org on an
 * unknown `tid` has no isolation boundary at all.
 */
export type TenantOrgResolver<Org> = (tid: string) => Org | null | Promise<Org | null>;
export type TenantOrgResolution<Org> = {
    ok: true;
    org: Org;
    tid: string;
} | {
    ok: false;
    reason: "unknown_tenant";
    message: string;
};
export declare function resolveTenantOrg<Org>(principal: IdentityPrincipal, resolver: TenantOrgResolver<Org>): Promise<TenantOrgResolution<Org>>;
export interface IdentityEnvKeys {
    issuerKeys: string[];
    audienceKeys: string[];
    jwksUriKeys: string[];
    /** Inline JWKS JSON — the fully-offline option, no refresher required. */
    jwksKeys: string[];
    leewayKeys: string[];
}
/**
 * Canonical env-key spec for the identity option, following the same
 * `HASNA_<NAME>_*` + `<NAME>_*` alias convention as `storageEnvKeys`.
 */
export declare function identityEnvKeys(name: string): IdentityEnvKeys;
/**
 * Environment shape. Structurally identical to `Env` in `./mode`, spelled out
 * here rather than imported so this module stays off the Zod schema graph, and
 * NOT re-exported so the package root keeps a single `Env`.
 */
type IdentityEnv = Record<string, string | undefined>;
export type IdentityConfigResolution = {
    enabled: false;
    reason: "unconfigured";
    checkedKeys: string[];
} | {
    enabled: false;
    reason: "invalid";
    error: string;
    checkedKeys: string[];
} | {
    enabled: true;
    config: IdentityProviderConfig;
    inlineJwks: FleetJwks | null;
    sources: Record<string, string>;
};
/**
 * Resolve the identity option from the environment.
 *
 * Three outcomes, and the middle one is the point:
 *   * NOTHING set -> disabled. The server runs on its in-repo API-key default,
 *     which is what R2/R3 require: one repo, fully runnable, no vendor
 *     endpoint and no vendor default. There is deliberately NO default issuer
 *     and NO default JWKS URI.
 *   * PARTIALLY set -> `invalid`, naming the missing variable. A half-configured
 *     identity option must NOT silently degrade to "API keys only": an operator
 *     who set an issuer believes tokens are being checked.
 *   * Fully set -> enabled.
 *
 * `audience` defaults to the app name, because the issuer stamps `aud` with the
 * app slug; it is overridable for services whose slug differs from their name.
 */
export declare function resolveIdentityConfig(name: string, env?: IdentityEnv): IdentityConfigResolution;
export {};
