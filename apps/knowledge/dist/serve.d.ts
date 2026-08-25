import { ApiKeyStore, type ApiKeyVerifier } from '@hasna/contracts/auth';
export { createKnowledgeDatabaseClient } from './db/remote-storage.js';
export { PG_MIGRATIONS } from './db/pg-migrations.js';
export { buildKnowledgePostgresMigrations } from './db/migrate-list.js';
export { MigrationLedger, defineMigration } from './generated/storage-kit/migrations.js';
import { type KnowledgeItem, type KnowledgeItemVersion, type KnowledgeItemVersionList } from './store.js';
import { type KnowledgeAuthorityBinding } from './guarded-write-contract.js';
import type { PoolQueryClient } from './generated/storage-kit/index.js';
import { type KnowledgeProjectLinksAuthority } from './project-links.js';
export declare const KNOWLEDGE_SERVE_APP = "knowledge";
/**
 * Restore the vendored storage kit's intended `sslmode=require` semantics
 * (encrypt, do NOT verify — the fleet standard for in-VPC RDS) under
 * node-postgres >= 8.22, which otherwise reinterprets a bare `sslmode=require`
 * as `verify-full`. Appends libpq-compat so `require`/`prefer` mean exactly what
 * the kit documents. Never logs the URL. Returns the (possibly) updated value.
 */
export declare function normalizePostgresDatabaseUrl(env?: NodeJS.ProcessEnv): string | undefined;
export interface NoteInput {
    /** Optional caller-supplied stable id (upsert). When present, create is an
     * idempotent upsert on this id — matching the local db.json upsert semantics so
     * `upsert --id <stable>` and data import/re-sync never duplicate through the server. */
    id?: string;
    title: string;
    content?: string;
    url?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
}
export interface NoteListOptions {
    limit?: number;
    offset?: number;
    /** Literal case-insensitive id/title/content filter. */
    filter?: string;
    /** Repeated raw tag filters; every raw filter narrows the result. */
    tags?: string[];
    archive?: 'active' | 'archived' | 'all';
    sort?: 'created' | 'title';
    direction?: 'asc' | 'desc';
}
export interface NoteSearchOptions {
    query: string;
    limit?: number;
    offset?: number;
    archive?: 'active' | 'archived' | 'all';
}
export interface NoteSearchHit {
    item: KnowledgeItem;
    rank: number;
}
/**
 * Attribution and concurrency control for a write. `actor`/`reason` are handed
 * to the database as transaction-local settings so the versioning trigger can
 * stamp them onto the snapshot it takes — the writer never inserts the history
 * row itself, which is the whole point (see db/pg-migrations.ts).
 */
export interface NoteWriteOptions {
    /** Authenticated identity performing the write; recorded on the snapshot. */
    actor?: string | null;
    /** Optional free-text justification recorded on the snapshot. */
    reason?: string | null;
}
export interface NoteUpdateOptions extends NoteWriteOptions {
    /**
     * Optimistic concurrency: apply only if the stored row is still at this
     * version. Absent means last-writer-wins (phase 1 — every installed 0.2.x CLI
     * on the fleet omits it and must keep working).
     */
    expectedVersion?: number;
}
/**
 * Raised when `expectedVersion` no longer matches the stored row. Carries both
 * numbers so a caller can decide whether a re-read-and-retry is safe, rather
 * than blind-retrying and overwriting the other writer.
 */
export declare class VersionConflictError extends Error {
    readonly expected: number;
    readonly current: number;
    readonly code = "version_conflict";
    constructor(expected: number, current: number);
}
/** A purge target is the live row, not a retained prior version. */
export declare class CannotPurgeLiveVersionError extends Error {
    readonly version: number;
    readonly current: number;
    readonly id: string;
    readonly code = "cannot_purge_live_version";
    constructor(version: number, current: number, id: string);
}
/**
 * One immutable snapshot of an entry, and a page of them. The shapes live in
 * store.ts next to KnowledgeItem so the CLI and SDK clients can consume them
 * without importing the server; these aliases keep the serve-side vocabulary.
 */
export type NoteVersion = KnowledgeItemVersion;
export type NoteVersionList = KnowledgeItemVersionList;
export declare class NoteRepo {
    private readonly client;
    constructor(client: PoolQueryClient);
    /**
     * Run a write with its attribution attached, in one transaction.
     *
     * `set_config(..., true)` is TRANSACTION-local, which is what makes this safe
     * on a pooled connection: the value cannot leak into the next request that
     * happens to be handed the same client. It resets to the empty string rather
     * than to unset, which is why the trigger reads it through NULLIF — otherwise
     * an unattributed write would record an actor that is present but blank.
     *
     * Every knowledge_items write goes through here, including the upsert branch
     * of create(), because that branch is an UPDATE whenever the id already
     * exists and must be attributed like any other edit.
     */
    private write;
    create(input: NoteInput, options?: NoteWriteOptions): Promise<KnowledgeItem>;
    list(options?: NoteListOptions, guardedTenantId?: string): Promise<{
        items: KnowledgeItem[];
        total: number;
    }>;
    /**
     * Ranked producer-side PostgreSQL full-text query. This endpoint is separate
     * from list filtering so public list compatibility remains literal.
     */
    search(options: NoteSearchOptions, guardedTenantId?: string): Promise<{
        items: NoteSearchHit[];
        total: number;
    }>;
    get(idOrShort: string, guardedTenantId?: string): Promise<KnowledgeItem | null>;
    update(idOrShort: string, patch: Partial<NoteInput> & {
        archived?: boolean;
    }, options?: NoteUpdateOptions): Promise<KnowledgeItem | null>;
    /**
     * Prior snapshots for an entry, newest first.
     *
     * Returns `null` — not an empty list — when the entry itself is absent. The
     * distinction is the whole lesson of the open-mementos read bug: "this entry
     * has never been edited" and "this entry does not exist" printed the same
     * "No previous versions" line, so an empty result was unreadable as evidence.
     */
    listVersions(idOrShort: string, options?: {
        limit?: number;
        offset?: number;
    }, guardedTenantId?: string): Promise<NoteVersionList | null>;
    /** One prior snapshot by version number, or `null` if that version is absent. */
    getVersion(idOrShort: string, version: number, guardedTenantId?: string): Promise<NoteVersion | null>;
    /**
     * Permanently purge retained prior versions of an entry — the secret-hygiene
     * capability that redacts history that must stop being reachable.
     *
     * The operation deletes by id/version and NEVER reads the retained body, so a
     * credential sitting in history cannot be rendered as a side effect of
     * removing it. The live row is never a purge target.
     *
     * Returns `null` — not an empty purge — when the entry itself is absent, the
     * same contract as {@link listVersions}. With no `version` option, every
     * retained prior version is deleted; with `version`, only that one.
     *
     * Deleting a retained version is consistent with the schema's own guard: the
     * append-only trigger blocks UPDATE of `knowledge_item_versions`, while
     * DELETE is deliberately allowed (it already cascades from item deletion).
     */
    purgeVersions(idOrShort: string, options?: {
        version?: number;
    }, guardedTenantId?: string): Promise<{
        purged: number;
        current_version: number;
    } | null>;
    delete(idOrShort: string): Promise<boolean>;
}
export interface KnowledgeServeGuardedAuthority extends KnowledgeAuthorityBinding {
}
export declare function knowledgeOpenApi(version: string): Record<string, unknown>;
export interface ServeDeps {
    client: PoolQueryClient;
    verifier: ApiKeyVerifier;
    store: ApiKeyStore;
    version: string;
    /**
     * Explicit authority for FCAME-1 production writes. When absent, legacy
     * routes keep working and guarded routes fail closed with 503.
     */
    guardedAuthority?: KnowledgeServeGuardedAuthority;
    /**
     * Optional test/host override for the package-owned project-link authority.
     * Production uses the same Postgres client as notes and scopes every
     * authority instance to the authenticated tenant.
     */
    projectLinksAuthority?: (tenantId: string) => KnowledgeProjectLinksAuthority;
}
export declare function createServeHandler(deps: ServeDeps): (req: Request) => Promise<Response>;
export interface StartServeOptions {
    port?: number;
    hostname?: string;
    env?: NodeJS.ProcessEnv;
}
export interface RunningServe {
    port: number;
    hostname: string;
    stop: () => Promise<void>;
}
export declare function resolveKnowledgeGuardedAuthority(env?: NodeJS.ProcessEnv): KnowledgeServeGuardedAuthority | undefined;
/**
 * Start the knowledge HTTP service on Bun. Opens the server PostgreSQL pool and a
 * contracts API-key verifier backed by the api_keys table (revocation).
 */
export declare function startKnowledgeServe(options?: StartServeOptions): Promise<RunningServe>;
