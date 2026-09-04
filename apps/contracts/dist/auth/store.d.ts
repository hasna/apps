import { type MintedApiKey } from "./keys.js";
/** Minimal row shape. Compatible with `pg` QueryResultRow. */
export type Row = Record<string, unknown>;
/**
 * Structural subset of the storage kit's `TypedQueryClient`. Any object with
 * these methods (the kit client, a pool wrapper, or a test shim) works.
 */
export interface AuthQueryClient {
    many<T extends Row>(sql: string, params?: readonly unknown[]): Promise<T[]>;
    get<T extends Row>(sql: string, params?: readonly unknown[]): Promise<T | null>;
    execute(sql: string, params?: readonly unknown[]): Promise<void>;
}
export declare const DEFAULT_API_KEYS_TABLE = "api_keys";
export declare const API_KEY_ISSUANCE_PENDING_REASON = "credential_delivery_pending";
export interface ApiKeyRecord {
    kid: string;
    app: string;
    agent: string | null;
    /** Tenant the key acts for; `null` for untenanted (pre-`tid`) keys. */
    tid: string | null;
    scopes: string[];
    tokenHash: string;
    issuedAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
    revokedReason: string | null;
    lastUsedAt: string | null;
    createdBy: string | null;
}
export type ApiKeyStatus = "active" | "revoked" | "expired" | "unknown";
/** Migration id + SQL, feedable to the kit's `MigrationLedger`. */
export interface AuthMigration {
    readonly id: string;
    readonly sql: string;
}
/**
 * Ordered migrations for the api-keys table (id namespaced to avoid clashes).
 *
 * 0003 adds the tenant column, as a SEPARATE migration. 0001's SQL MUST NOT be
 * edited to include it, and not merely because a deployed ledger would not
 * re-run 0001: consumers feed these straight into a CONTENT-ADDRESSED ledger
 * (`checksumSql` in src/kit/templates/migrations.ts) that aborts the whole
 * migration run on `Migration checksum mismatch`. Editing 0001 therefore breaks
 * the upgrade AND prevents 0003 from ever running, so the column would never
 * land. `tests/auth-tenant.test.ts` pins 0001's and 0002's checksums to make
 * that mistake impossible to commit.
 *
 * The column is `TEXT NULL` with no DEFAULT — matching the contract's wire
 * type, and nullable because keys issued before the tenant claim existed are
 * untenanted, not tenant-zero.
 */
export declare function apiKeyMigrations(table?: string): AuthMigration[];
export interface InsertKeyInput {
    kid: string;
    app: string;
    agent?: string | null;
    /**
     * Tenant the key acts for. Omit or `null` for an untenanted key. Validated
     * and canonicalized on the way in: a store that accepted ids no token could
     * carry, or that stored two spellings of one UUID, would reopen the drift
     * this claim exists to close.
     */
    tid?: string | null;
    scopes: string[];
    tokenHash: string;
    issuedAt: Date;
    expiresAt: Date | null;
    createdBy?: string | null;
}
export interface ApiKeyStoreOptions {
    table?: string;
}
/** DB-backed store for issued API keys. */
export declare class ApiKeyStore {
    private readonly client;
    readonly table: string;
    constructor(client: AuthQueryClient, options?: ApiKeyStoreOptions);
    /** Migrations for this store's table, for the kit's `MigrationLedger`. */
    migrations(): AuthMigration[];
    /** Idempotently create the table + indexes (standalone path). */
    ensureSchema(): Promise<void>;
    /** Insert a hashed key record. Throws on duplicate kid/token hash. */
    insert(input: InsertKeyInput): Promise<void>;
    private insertWithLifecycle;
    private mintedInput;
    /** Convenience: persist the record for a freshly minted active key. */
    insertMinted(minted: MintedApiKey, createdBy?: string): Promise<void>;
    /**
     * Persist a freshly minted key in a fail-closed issuance state.
     *
     * The existing revocation columns deliberately carry this state so every
     * released verifier already refuses the key. No schema migration or consumer
     * upgrade is needed before credential-safe issuance can use it.
     */
    insertMintedPending(minted: MintedApiKey, createdBy?: string, atMs?: number): Promise<void>;
    /**
     * Idempotently activate one issuance identified by kid + token hash.
     *
     * A committed UPDATE can lose its response. Repeating this method then sees
     * the already-active exact record and returns true; a different token with a
     * colliding kid can never be accepted as the same issuance.
     */
    activatePending(kid: string, tokenHash: string): Promise<boolean>;
    findByKid(kid: string): Promise<ApiKeyRecord | null>;
    findByTokenHash(tokenHash: string): Promise<ApiKeyRecord | null>;
    /**
     * Revocation check for the middleware. Returns `true` (deny) only when a
     * record exists AND is explicitly revoked. Unknown kids return `false` — the
     * token is cryptographically valid and simply was not persisted here. Use
     * {@link statusChecker} for strict "must be recorded and active" semantics.
     */
    isRevoked: (kid: string) => Promise<boolean>;
    /** Resolve the lifecycle status of a kid (unknown/active/revoked/expired). */
    status(kid: string, nowMs?: number): Promise<ApiKeyStatus>;
    /**
     * Bound status resolver for `verifyApiKey({ keyStatus })` — the recommended
     * wiring. Reports WHICH way a key failed (`unknown` / `revoked` / `expired`)
     * rather than collapsing all three into one boolean, so the audit trail can
     * distinguish a key we turned off from a key we never issued.
     *
     * Bound as a property, like {@link isRevoked}, so `keyStatus: store.keyStatus`
     * works without the caller remembering to bind `this`.
     */
    keyStatus: (kid: string) => Promise<ApiKeyStatus>;
    /**
     * Strict boolean checker: denies unknown OR revoked OR expired kids (an
     * unrecorded token cannot authenticate). Prefer {@link keyStatus}, which
     * carries the reason; this remains for `isRevoked`-shaped call sites.
     */
    statusChecker(): (kid: string) => Promise<boolean>;
    /**
     * Revoke a key by kid. Returns true if a row was affected.
     *
     * `options.app` SCOPES the write to one app's keys. One `api_keys` table
     * serves every app in a shared database (that is what the `app` column and
     * {@link list}'s `app` filter are for), and a kid is a bare opaque id with no
     * app in it — so an unscoped `WHERE kid = $1` lets an operator holding
     * `<appA>:keys.admin` revoke `appB`'s client key by kid alone. Pass the app
     * whenever the caller's authority is app-scoped; the clause is applied in the
     * same statement as the update, so there is no window between the ownership
     * check and the write.
     */
    revoke(kid: string, reason?: string, atMs?: number, options?: {
        app?: string;
    }): Promise<boolean>;
    /** Record last-used for a kid (best-effort telemetry). */
    touchLastUsed(kid: string, atMs?: number): Promise<void>;
    /**
     * List keys, optionally filtered by app and/or tenant, excluding revoked by
     * default. `tid` filters to exactly that tenant; it never falls back to
     * "all tenants" when the filter does not match, so an operator listing one
     * organization's keys cannot accidentally enumerate another's. A `tid` that
     * is present but unusable (empty, whitespace, or outside the grammar) THROWS
     * rather than listing anything.
     */
    list(options?: {
        app?: string;
        tid?: string;
        includeRevoked?: boolean;
    }): Promise<ApiKeyRecord[]>;
    /** The set of currently-revoked kids (for building an in-memory deny-set). */
    revokedKids(): Promise<string[]>;
}
