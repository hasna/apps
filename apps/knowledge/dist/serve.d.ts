import { ApiKeyStore, type ApiKeyVerifier } from '@hasna/contracts/auth';
import { type KnowledgeItem } from './store.js';
import type { PoolQueryClient } from './generated/storage-kit/index.js';
export declare const KNOWLEDGE_SERVE_APP = "knowledge";
/**
 * Restore the vendored storage kit's intended `sslmode=require` semantics
 * (encrypt, do NOT verify — the fleet standard for in-VPC RDS) under
 * node-postgres >= 8.22, which otherwise reinterprets a bare `sslmode=require`
 * as `verify-full`. Appends libpq-compat so `require`/`prefer` mean exactly what
 * the kit documents. Never logs the URL. Returns the (possibly) updated value.
 */
export declare function normalizeCloudDatabaseUrl(env?: NodeJS.ProcessEnv): string | undefined;
export interface NoteInput {
    /** Optional caller-supplied stable id (upsert). When present, create is an
     * idempotent upsert on this id — matching the local db.json upsert semantics so
     * `upsert --id <stable>` and data import/re-sync never duplicate in cloud mode. */
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
    search?: string;
    includeArchived?: boolean;
}
export declare class NoteRepo {
    private readonly client;
    constructor(client: PoolQueryClient);
    create(input: NoteInput): Promise<KnowledgeItem>;
    list(options?: NoteListOptions): Promise<{
        items: KnowledgeItem[];
        total: number;
    }>;
    get(idOrShort: string): Promise<KnowledgeItem | null>;
    update(idOrShort: string, patch: Partial<NoteInput> & {
        archived?: boolean;
    }): Promise<KnowledgeItem | null>;
    delete(idOrShort: string): Promise<boolean>;
}
export declare function knowledgeOpenApi(version: string): Record<string, unknown>;
export interface ServeDeps {
    client: PoolQueryClient;
    verifier: ApiKeyVerifier;
    store: ApiKeyStore;
    version: string;
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
/**
 * Start the knowledge HTTP service on Bun. Opens a PURE-REMOTE cloud pool and a
 * contracts API-key verifier backed by the api_keys table (revocation).
 */
export declare function startKnowledgeServe(options?: StartServeOptions): Promise<RunningServe>;
