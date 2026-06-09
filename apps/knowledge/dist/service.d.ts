import { type KnowledgeAuthStatus } from './auth';
import { type KnowledgePromptOptions } from './agent';
import { type KnowledgeSyncConflictAiProposalOptions } from './conflict-agent';
import { type EmbeddingIndexOptions, type EmbeddingSearchOptions } from './embeddings';
import { type KnowledgeMachinePreflightOptions, type KnowledgeMachineRouteResolution, type KnowledgeMachineWorkspaceResolution, type KnowledgeMachineTopologyOptions } from './machines';
import { type ProviderStatusResult, type ModelRegistryEntry } from './providers';
import { type ReindexRuntimeOptions } from './reindex';
import { RemoteKnowledgeClient, type RemoteKnowledgeRegistryContract } from './remote-client';
import { type RetrievalOptions } from './retrieval';
import { type HybridSearchOptions } from './search';
import { type WebSearchOptions } from './web-search';
import { type KnowledgeSyncConflict, type KnowledgeSyncConflictResolutionProposal, type KnowledgePeerSyncResult, type KnowledgeSyncApplyResult, type KnowledgeSyncBundle, type KnowledgeSyncSnapshotResult, type KnowledgeSyncStatus } from './sync';
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
export interface KnowledgeSyncSnapshotOptions {
    includeTailscale?: boolean;
    machineId?: string;
}
export interface KnowledgeSyncBundleOptions {
    machineId?: string | null;
    tables?: string[];
    includeArtifactContent?: boolean;
    recordClocks?: boolean;
}
export interface KnowledgeSyncImportOptions {
    bundle: KnowledgeSyncBundle;
    dryRun?: boolean;
    direction?: 'pull' | 'push' | 'import';
    machineId?: string | null;
}
export interface KnowledgePeerSyncOptions {
    peerWorkspace: string;
    direction?: 'pull' | 'push' | 'both';
    dryRun?: boolean;
    tables?: string[];
    includeArtifactContent?: boolean;
    machineId?: string | null;
}
export interface KnowledgeRemotePeerSyncOptions extends Omit<KnowledgePeerSyncOptions, 'peerWorkspace'> {
    machine: string;
    peerWorkspace?: string;
    includeTailscale?: boolean;
}
export interface KnowledgeRemotePeerSyncResult extends KnowledgePeerSyncResult {
    transport: 'ssh';
    machine: string;
    resolved_machine: string;
    resolved_route: {
        source: KnowledgeMachineRouteResolution['source'];
        adapter: KnowledgeMachineRouteResolution['adapter'];
        target: string;
        route: KnowledgeMachineRouteResolution['route'];
        target_kind: KnowledgeMachineRouteResolution['targetKind'];
        confidence: KnowledgeMachineRouteResolution['confidence'];
        evidence: KnowledgeMachineRouteResolution['evidence'];
    };
    resolved_workspace: NonNullable<KnowledgePeerSyncResult['resolved_workspace']>;
    peer_workspace: string;
}
export interface KnowledgeSyncDoctorOptions {
    machine?: string | null;
    peerWorkspace?: string | null;
    includeTailscale?: boolean;
    tables?: string[];
}
export interface KnowledgeSyncRecommendedCommand {
    id: string;
    reason: string;
    command: string[];
    shell_command: string;
}
export interface KnowledgeOpenFilesBoundaryStatus {
    ok: boolean;
    source_of_truth: 'open-files';
    configured_root: string | null;
    configured_root_source: KnowledgeMachineWorkspaceResolution['open_files_root_source'] | null;
    source_refs: {
        open_files: number;
        metadata_mentions: number;
    };
    extracted_text_artifacts: number;
    raw_source_bytes_owned_by: 'open-files';
    raw_payload_sentinel_hits: number;
    message: string;
}
export interface KnowledgeArtifactManifestStatus {
    ok: boolean;
    read_only: true;
    storage_type: StorageContract['storage_type'];
    artifact_uri_prefix: string;
    s3: StorageContract['artifact_store']['s3'];
    artifacts: {
        total: number;
        by_kind: Array<{
            kind: string;
            count: number;
        }>;
        with_hash: number;
        missing_hash: number;
        with_size: number;
        missing_size: number;
        total_size_bytes: number;
    };
    uri_prefix: {
        matching: number;
        mismatched: number;
        examples: string[];
    };
    keys: {
        with_key: number;
        missing_key: number;
        prefixed_with_storage_prefix: number;
        prefixed_examples: string[];
    };
    sync_manifest: {
        copied_by_sync: true;
        generated_artifacts_only: true;
        includes_raw_source_bytes: false;
        hash_algorithm: 'sha256';
        portable_keys: boolean;
    };
    raw_payload_sentinel_hits: number;
    warnings: string[];
    message: string;
}
export interface KnowledgeArtifactManifestKeyRepairCandidate {
    id: string;
    artifact_uri: string;
    kind: string;
    current_key: string;
    repaired_key: string;
    hash: string | null;
    size_bytes: number | null;
}
export interface KnowledgeArtifactManifestKeyRepairResult {
    ok: boolean;
    dry_run: boolean;
    approval_required: boolean;
    storage_type: StorageContract['storage_type'];
    storage_prefix: string | null;
    candidates: KnowledgeArtifactManifestKeyRepairCandidate[];
    repaired: number;
    audit_event_id: string | null;
    message: string;
}
export interface KnowledgeSyncDoctorResult {
    ok: boolean;
    read_only: true;
    generated_at: string;
    scope: string;
    workspace_home: string;
    database: {
        sqlite_schema_version: number;
        table_counts: Record<string, number>;
    };
    storage: {
        contract: StorageContract;
        validation: StorageValidationResult;
        artifact_manifest: KnowledgeArtifactManifestStatus;
    };
    sync: {
        machines: number;
        snapshots: number;
        clocks: number;
        imports: number;
        open_conflicts: number;
        table_clocks: KnowledgeSyncStatus['clocks']['rows'];
    };
    open_files: KnowledgeOpenFilesBoundaryStatus;
    resolved_route: KnowledgeRemotePeerSyncResult['resolved_route'] | null;
    resolved_workspace: KnowledgePeerSyncResult['resolved_workspace'] | null;
    recommended_commands: KnowledgeSyncRecommendedCommand[];
    warnings: string[];
    message: string;
}
export interface KnowledgeSyncConflictResolveOptions {
    id: string;
    strategy?: string;
    approvedBy?: string;
    approveWrite?: boolean;
    proposedPatchUri?: string | null;
}
export interface KnowledgeSyncConflictAiProposalServiceOptions {
    id: string;
    modelRef?: string;
    fake?: boolean;
    env?: KnowledgeSyncConflictAiProposalOptions['env'];
}
export type KnowledgeSyncConflictResolveResult = {
    ok: false;
    approval_required: true;
    conflict: KnowledgeSyncConflict;
    proposal: KnowledgeSyncConflictResolutionProposal;
    message: string;
} | {
    ok: true;
    approval_required: false;
    conflict: KnowledgeSyncConflict;
    audit_event_id: string;
    message: string;
};
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
    machineTopology(options?: Omit<KnowledgeMachineTopologyOptions, 'knowledge'>): Promise<import("./machines").KnowledgeMachineTopology>;
    machinePreflight(options?: Omit<KnowledgeMachinePreflightOptions, 'knowledge'>): Promise<import("./machines").KnowledgeMachinePreflightReport>;
    syncStatus(): KnowledgeSyncStatus;
    syncDoctor(options?: KnowledgeSyncDoctorOptions): Promise<KnowledgeSyncDoctorResult>;
    repairArtifactManifestKeys(options?: {
        approveWrite?: boolean;
        approvedBy?: string;
        dryRun?: boolean;
    }): KnowledgeArtifactManifestKeyRepairResult;
    createSyncSnapshot(options?: KnowledgeSyncSnapshotOptions): Promise<KnowledgeSyncSnapshotResult>;
    syncConflicts(options?: {
        status?: string;
        limit?: number;
    }): KnowledgeSyncConflict[];
    syncConflict(id: string): KnowledgeSyncConflict;
    proposeSyncConflictResolution(id: string): KnowledgeSyncConflictResolutionProposal;
    proposeSyncConflictResolutionWithAi(options: KnowledgeSyncConflictAiProposalServiceOptions): Promise<KnowledgeSyncConflictResolutionProposal>;
    resolveSyncConflict(options: KnowledgeSyncConflictResolveOptions): KnowledgeSyncConflictResolveResult;
    syncMachines(): import("./sync").KnowledgeSyncMachineRow[];
    exportSyncBundle(options?: KnowledgeSyncBundleOptions): KnowledgeSyncBundle;
    importSyncBundle(options: KnowledgeSyncImportOptions): Promise<KnowledgeSyncApplyResult>;
    syncRemotePeer(options: KnowledgeRemotePeerSyncOptions): Promise<KnowledgeRemotePeerSyncResult>;
    syncPeer(options: KnowledgePeerSyncOptions): Promise<KnowledgePeerSyncResult>;
}
export declare function createKnowledgeService(options?: KnowledgeServiceOptions): KnowledgeService;
