import type { ApiKeyStore, ApiKeyVerifier } from '@hasna/contracts/auth';
import type { KnowledgeItem } from './store.js';
import type { PoolQueryClient } from './generated/storage-kit/index.js';
export declare const KNOWLEDGE_SERVE_APP = "knowledge";
/** Redacted compatibility surface: reports presence without returning a DSN. */
export declare function normalizeCloudDatabaseUrl(env?: NodeJS.ProcessEnv): string | undefined;
export interface NoteInput {
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
 * Start the Stage-A liveness server. It intentionally constructs no auth,
 * Postgres, schema, provider, or hosted transport dependencies.
 */
export declare function startKnowledgeServe(options?: StartServeOptions): Promise<RunningServe>;
