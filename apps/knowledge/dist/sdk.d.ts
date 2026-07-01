import { KnowledgeService, type KnowledgeServiceOptions } from './service.js';
export type KnowledgeClientOptions = KnowledgeServiceOptions;
export type KnowledgeSetupOptions = Parameters<KnowledgeService['setup']>[0];
export type KnowledgeAuthInput = Parameters<KnowledgeService['saveAuth']>[0];
export type KnowledgeAskOptions = Omit<Parameters<KnowledgeService['runPrompt']>[0], 'prompt'>;
export type KnowledgeSearchOptions = Parameters<KnowledgeService['search']>[0];
export type KnowledgeContextOptions = Parameters<KnowledgeService['retrieveContext']>[0];
export type KnowledgeAgentContextPackOptions = Parameters<KnowledgeService['contextPack']>[0];
export type KnowledgeWebSearchOptions = Parameters<KnowledgeService['webSearch']>[0];
export type KnowledgeInventoryOptions = Parameters<KnowledgeService['inventory']>[0];
export type KnowledgeSyncSnapshotOptions = Parameters<KnowledgeService['createSyncSnapshot']>[0];
export type KnowledgeSyncDoctorOptions = Parameters<KnowledgeService['syncDoctor']>[0];
export type KnowledgeSyncBundleOptions = Parameters<KnowledgeService['exportSyncBundle']>[0];
export type KnowledgeSyncImportOptions = Parameters<KnowledgeService['importSyncBundle']>[0];
export type KnowledgePeerSyncOptions = Parameters<KnowledgeService['syncPeer']>[0];
export type KnowledgeRemotePeerSyncOptions = Parameters<KnowledgeService['syncRemotePeer']>[0];
export type KnowledgeRulesProvenanceOptions = Parameters<KnowledgeService['importRulesProvenance']>[0];
export type KnowledgeAppWikiInitOptions = Parameters<KnowledgeService['initAppWiki']>[0];
export type KnowledgeAppWikiNoteInput = Parameters<KnowledgeService['addAppWikiNote']>[0];
export type KnowledgeAppWikiSourceInput = Parameters<KnowledgeService['addAppWikiSourceRef']>[0];
export type KnowledgeAppWikiSearchOptions = Parameters<KnowledgeService['searchAppWiki']>[0];
export type KnowledgeAppWikiQueryOptions = Parameters<KnowledgeService['queryAppWiki']>[0];
export interface KnowledgeAppWikiScopeOptions extends KnowledgeClientOptions {
    allowGlobal?: boolean;
}
export interface KnowledgeAppWikiSdk {
    readonly paths: () => ReturnType<KnowledgeService['paths']>;
    readonly init: (options?: KnowledgeAppWikiInitOptions) => ReturnType<KnowledgeService['initAppWiki']>;
    readonly notes: {
        readonly add: (input: KnowledgeAppWikiNoteInput) => ReturnType<KnowledgeService['addAppWikiNote']>;
        readonly list: (options?: Parameters<KnowledgeService['listAppWikiNotes']>[0]) => ReturnType<KnowledgeService['listAppWikiNotes']>;
        readonly get: (id: string, options?: Parameters<KnowledgeService['getAppWikiNote']>[1]) => ReturnType<KnowledgeService['getAppWikiNote']>;
    };
    readonly sources: {
        readonly add: (input: KnowledgeAppWikiSourceInput) => ReturnType<KnowledgeService['addAppWikiSourceRef']>;
    };
    readonly search: (options: KnowledgeAppWikiSearchOptions) => ReturnType<KnowledgeService['searchAppWiki']>;
    readonly query: (options: KnowledgeAppWikiQueryOptions) => ReturnType<KnowledgeService['queryAppWiki']>;
}
export interface KnowledgeClient {
    /**
     * Escape hatch for advanced integrations. Prefer the grouped SDK methods for
     * app-facing code; this service may expose lower-level operations over time.
     */
    readonly unstable_service: KnowledgeService;
    readonly paths: () => ReturnType<KnowledgeService['paths']>;
    readonly setup: (options?: KnowledgeSetupOptions) => ReturnType<KnowledgeService['setup']>;
    readonly auth: {
        readonly status: (env?: Record<string, string | undefined>) => ReturnType<KnowledgeService['authStatus']>;
        readonly login: (input: KnowledgeAuthInput, env?: Record<string, string | undefined>) => ReturnType<KnowledgeService['saveAuth']>;
        readonly logout: (env?: Record<string, string | undefined>) => ReturnType<KnowledgeService['clearAuth']>;
    };
    readonly remote: {
        readonly contract: () => ReturnType<KnowledgeService['remoteContract']>;
        readonly client: (env?: Record<string, string | undefined>) => ReturnType<KnowledgeService['remoteClient']>;
    };
    readonly storage: {
        readonly status: () => ReturnType<KnowledgeService['storageContract']>;
        readonly validate: () => ReturnType<KnowledgeService['validateStorage']>;
        readonly migrateLegacyPath: (options?: Parameters<KnowledgeService['migrateLegacyPath']>[0]) => ReturnType<KnowledgeService['migrateLegacyPath']>;
        readonly artifactStore: () => ReturnType<KnowledgeService['artifactStore']>;
    };
    readonly sync: {
        readonly status: () => ReturnType<KnowledgeService['syncStatus']>;
        readonly doctor: (options?: KnowledgeSyncDoctorOptions) => ReturnType<KnowledgeService['syncDoctor']>;
        readonly snapshot: (options?: KnowledgeSyncSnapshotOptions) => ReturnType<KnowledgeService['createSyncSnapshot']>;
        readonly conflicts: (options?: Parameters<KnowledgeService['syncConflicts']>[0]) => ReturnType<KnowledgeService['syncConflicts']>;
        readonly conflict: (id: string) => ReturnType<KnowledgeService['syncConflict']>;
        readonly proposeConflictResolution: (id: string) => ReturnType<KnowledgeService['proposeSyncConflictResolution']>;
        readonly proposeConflictResolutionAi: (options: Parameters<KnowledgeService['proposeSyncConflictResolutionWithAi']>[0]) => ReturnType<KnowledgeService['proposeSyncConflictResolutionWithAi']>;
        readonly resolveConflict: (options: Parameters<KnowledgeService['resolveSyncConflict']>[0]) => ReturnType<KnowledgeService['resolveSyncConflict']>;
        readonly machines: () => ReturnType<KnowledgeService['syncMachines']>;
        readonly exportBundle: (options?: KnowledgeSyncBundleOptions) => ReturnType<KnowledgeService['exportSyncBundle']>;
        readonly importBundle: (options: KnowledgeSyncImportOptions) => ReturnType<KnowledgeService['importSyncBundle']>;
        readonly peer: (options: KnowledgePeerSyncOptions) => ReturnType<KnowledgeService['syncPeer']>;
        readonly remotePeer: (options: KnowledgeRemotePeerSyncOptions) => ReturnType<KnowledgeService['syncRemotePeer']>;
    };
    readonly inventory: (options?: KnowledgeInventoryOptions) => ReturnType<KnowledgeService['inventory']>;
    readonly db: {
        readonly init: () => ReturnType<KnowledgeService['initDb']>;
        readonly stats: () => ReturnType<KnowledgeService['dbStats']>;
    };
    readonly wiki: {
        readonly init: () => ReturnType<KnowledgeService['initWiki']>;
        readonly compile: (options?: Parameters<KnowledgeService['compileWiki']>[0]) => ReturnType<KnowledgeService['compileWiki']>;
        readonly fileAnswer: (options: Parameters<KnowledgeService['fileAnswer']>[0]) => ReturnType<KnowledgeService['fileAnswer']>;
        readonly lint: () => ReturnType<KnowledgeService['lintWiki']>;
    };
    readonly appWiki: KnowledgeAppWikiSdk;
    readonly ingest: {
        readonly manifest: (input: string) => ReturnType<KnowledgeService['ingestManifest']>;
        readonly source: (sourceRef: string, purpose?: string) => ReturnType<KnowledgeService['ingestSource']>;
        readonly rules: (options?: KnowledgeRulesProvenanceOptions) => ReturnType<KnowledgeService['importRulesProvenance']>;
    };
    readonly sources: {
        readonly resolve: (sourceRef: string, options?: Parameters<KnowledgeService['resolveSource']>[1]) => ReturnType<KnowledgeService['resolveSource']>;
        readonly consumeOutbox: (input: string) => ReturnType<KnowledgeService['consumeOutbox']>;
    };
    readonly reindex: {
        readonly health: (options?: Parameters<KnowledgeService['reindexHealth']>[0]) => ReturnType<KnowledgeService['reindexHealth']>;
        readonly enqueue: (options?: Parameters<KnowledgeService['enqueueReindex']>[0]) => ReturnType<KnowledgeService['enqueueReindex']>;
        readonly refreshEmbeddings: (options?: Parameters<KnowledgeService['refreshEmbeddings']>[0]) => ReturnType<KnowledgeService['refreshEmbeddings']>;
    };
    readonly providers: {
        readonly status: (env?: Record<string, string | undefined>) => ReturnType<KnowledgeService['providerStatus']>;
        readonly models: () => ReturnType<KnowledgeService['modelRegistry']>;
    };
    readonly embeddings: {
        readonly status: () => ReturnType<KnowledgeService['embeddingStatus']>;
        readonly index: (options?: Parameters<KnowledgeService['indexEmbeddings']>[0]) => ReturnType<KnowledgeService['indexEmbeddings']>;
        readonly search: (options: Parameters<KnowledgeService['semanticSearch']>[0]) => ReturnType<KnowledgeService['semanticSearch']>;
    };
    readonly search: (options: KnowledgeSearchOptions) => ReturnType<KnowledgeService['search']>;
    readonly retrieveContext: (options: KnowledgeContextOptions) => ReturnType<KnowledgeService['retrieveContext']>;
    readonly contextPack: (options: KnowledgeAgentContextPackOptions) => ReturnType<KnowledgeService['contextPack']>;
    readonly context: {
        readonly pack: (options: KnowledgeAgentContextPackOptions) => ReturnType<KnowledgeService['contextPack']>;
    };
    readonly ask: (prompt: string, options?: KnowledgeAskOptions) => ReturnType<KnowledgeService['runPrompt']>;
    readonly build: (prompt: string, options?: KnowledgeAskOptions) => ReturnType<KnowledgeService['runPrompt']>;
    readonly web: {
        readonly search: (options: KnowledgeWebSearchOptions) => ReturnType<KnowledgeService['webSearch']>;
    };
}
export declare function createKnowledgeClient(options?: KnowledgeClientOptions): KnowledgeClient;
export declare const createKnowledgeSdk: typeof createKnowledgeClient;
export declare function createAppWikiScope(options?: KnowledgeAppWikiScopeOptions): KnowledgeAppWikiSdk;
export declare function openProjectWiki(options?: Omit<KnowledgeAppWikiScopeOptions, 'scope' | 'allowGlobal'>): KnowledgeAppWikiSdk;
export declare function openGlobalWiki(options: Omit<KnowledgeAppWikiScopeOptions, 'scope'> & {
    allowGlobal: true;
}): KnowledgeAppWikiSdk;
