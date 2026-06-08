import { type KnowledgeAuthStatus } from './auth';
import { type KnowledgePromptOptions } from './agent';
import { type EmbeddingIndexOptions, type EmbeddingSearchOptions } from './embeddings';
import { type ProviderStatusResult, type ModelRegistryEntry } from './providers';
import { type ReindexRuntimeOptions } from './reindex';
import { RemoteKnowledgeClient, type RemoteKnowledgeRegistryContract } from './remote-client';
import { type RetrievalOptions } from './retrieval';
import { type HybridSearchOptions } from './search';
import { type WebSearchOptions } from './web-search';
import { type WikiCompileOptions } from './wiki-compiler';
import { type StorageContract, type StorageValidationResult } from './storage-contract';
import { type KnowledgeConfig, type KnowledgeWorkspace } from './workspace';
export interface KnowledgeServiceOptions {
    scope?: string;
    cwd?: string;
}
export interface KnowledgePathsResult {
    ok: true;
    scope: string;
    home: string;
    config_path: string;
    json_store_path: string;
    knowledge_db_path: string;
    artifacts_dir: string;
    indexes_dir: string;
    logs_dir: string;
    runs_dir: string;
    schemas_dir: string;
    wiki_dir: string;
    config: KnowledgeConfig;
    message: string;
}
export interface KnowledgeSetupResult {
    ok: true;
    mode: KnowledgeConfig['mode'];
    api_url: string | null;
    storage_type: KnowledgeConfig['storage']['type'];
    artifact_uri_prefix: string;
    canonical_hasna_xyz: StorageContract['canonical_hasna_xyz'];
    config_path: string;
    next: string[];
    message: string;
}
export declare class KnowledgeService {
    private readonly options;
    private ensuredWorkspace?;
    private cachedConfig?;
    constructor(options?: KnowledgeServiceOptions);
    get scope(): string;
    get workspace(): KnowledgeWorkspace;
    ensureWorkspace(): KnowledgeWorkspace;
    jsonStorePath(): string;
    config(): KnowledgeConfig;
    safetyPolicy(): import("./safety").SafetyPolicy;
    artifactStore(): import("./artifact-store").ArtifactStore;
    storageContract(): StorageContract;
    validateStorage(): StorageValidationResult;
    setup(options?: {
        mode?: string;
        apiUrl?: string;
        canonicalHasnaXyz?: boolean;
    }): KnowledgeSetupResult;
    authStatus(env?: Record<string, string | undefined>): KnowledgeAuthStatus;
    saveAuth(input: {
        apiKey: string;
        email?: string;
        orgId?: string;
        orgSlug?: string;
        userId?: string;
        apiUrl?: string;
    }, env?: Record<string, string | undefined>): import("./auth").KnowledgeAuthConfig;
    clearAuth(env?: Record<string, string | undefined>): boolean;
    remoteContract(): RemoteKnowledgeRegistryContract;
    remoteClient(env?: Record<string, string | undefined>): RemoteKnowledgeClient | null;
    paths(): KnowledgePathsResult;
    initDb(): {
        path: string;
        schema_version: number;
    };
    dbStats(): import("./knowledge-db").KnowledgeDbStats;
    initWiki(): Promise<import("./wiki-layout").WikiLayoutInitResult>;
    compileWiki(options?: Omit<WikiCompileOptions, 'dbPath' | 'store'>): Promise<import("./wiki-compiler").WikiCompileResult>;
    fileAnswer(options: {
        prompt: string;
        answer: string;
        approveWrite?: boolean;
        limit?: number;
        semantic?: boolean;
        modelRef?: string;
        dimensions?: number;
        fake?: boolean;
    }): Promise<import("./wiki-compiler").WikiAnswerFileResult>;
    lintWiki(): import("./wiki-compiler").WikiLintResult;
    ingestManifest(input: string): Promise<import("./manifest-ingest").ManifestIngestResult>;
    ingestSource(sourceRef: string, purpose?: string): Promise<import("./source-ingest").SourceIngestResult>;
    resolveSource(sourceRef: string, options?: {
        purpose?: string;
        limit?: number;
    }): Promise<import("./source-resolver").SourceResolveResult>;
    consumeOutbox(input: string): Promise<import("./outbox-consume").OutboxConsumeResult>;
    reindexHealth(options?: Omit<ReindexRuntimeOptions, 'dbPath' | 'config'>): import("./reindex").ReindexHealthResult;
    enqueueReindex(options?: Omit<ReindexRuntimeOptions, 'dbPath' | 'config'>): import("./reindex").ReindexEnqueueResult;
    refreshEmbeddings(options?: Omit<ReindexRuntimeOptions & {
        full?: boolean;
        limit?: number;
    }, 'dbPath' | 'config'>): Promise<import("./reindex").ReindexEmbeddingsResult>;
    providerStatus(env?: Record<string, string | undefined>): ProviderStatusResult;
    modelRegistry(): ModelRegistryEntry[];
    embeddingStatus(): import("./embeddings").EmbeddingStatusResult;
    indexEmbeddings(options?: Omit<EmbeddingIndexOptions, 'dbPath' | 'config'>): Promise<import("./embeddings").EmbeddingIndexResult>;
    semanticSearch(options: Omit<EmbeddingSearchOptions, 'dbPath' | 'config'>): Promise<import("./embeddings").SemanticSearchResult>;
    search(options: Omit<HybridSearchOptions, 'dbPath' | 'config'>): Promise<import("./search").HybridSearchResult>;
    retrieveContext(options: Omit<RetrievalOptions, 'dbPath' | 'config'>): Promise<import("./retrieval").KnowledgeContextPack>;
    runPrompt(options: Omit<KnowledgePromptOptions, 'dbPath' | 'config'>): Promise<import("./agent").KnowledgePromptResult>;
    webSearch(options: Omit<WebSearchOptions, 'dbPath' | 'config' | 'safetyPolicy'>): Promise<import("./web-search").WebSearchResult>;
}
export declare function createKnowledgeService(options?: KnowledgeServiceOptions): KnowledgeService;
