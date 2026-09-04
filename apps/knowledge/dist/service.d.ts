import { type AppWikiInitResult, type AppWikiNoteGetResult, type AppWikiNoteRecord, type AppWikiNoteWriteResult } from './app-wiki';
import { type KnowledgeAuthProbe, type KnowledgeAuthStatus } from './auth';
import { type KnowledgePromptOptions } from './agent';
import { type KnowledgeAgentContextPack, type KnowledgeAgentContextPackOptions } from './context-pack';
import { type KnowledgeSyncConflictAiProposalOptions } from './conflict-agent';
import { type EmbeddingIndexOptions, type EmbeddingSearchOptions } from './embeddings';
import { type KnowledgeMachinePreflightOptions, type KnowledgeMachineRouteResolution, type KnowledgeMachineWorkspaceResolution, type KnowledgeMachineTopologyOptions } from './machines';
import { type ProviderStatusResult, type ModelRegistryEntry } from './providers';
import { type DurableKnowledgeRecord, type EnqueueKnowledgePromotionInput, type KnowledgePromotionCandidate, type KnowledgePromotionKind, type KnowledgePromotionStatus, type PromoteKnowledgeCandidateOptions } from './promotion-inbox';
import { type ReindexRuntimeOptions } from './reindex';
import { type KnowledgeContextPack, type RetrievalOptions } from './retrieval';
import { type RulesProvenanceImportResult } from './rules-provenance';
import { type HybridSearchOptions, type HybridSearchResult } from './search';
import { type SafetyPolicy } from './safety';
import { type WebSearchOptions } from './web-search';
import { type KnowledgeSyncConflict, type KnowledgeSyncConflictResolutionProposal, type KnowledgePeerSyncResult, type KnowledgeSyncApplyResult, type KnowledgeSyncBundle, type KnowledgeSyncMachineRow, type KnowledgeSyncSnapshotResult, type KnowledgeSyncStatus } from './sync';
import { type WikiCompileOptions } from './wiki-compiler';
import { type StorageContract, type StorageValidationResult } from './storage-contract';
import { type KnowledgeItem } from './store';
import { type ItemStore, type ItemCreateInput, type ItemPatch, type ItemListOptions, type ItemListResult } from './item-store';
import { type KnowledgeConfig, type KnowledgeWorkspace } from './workspace';
import { type KnowledgeLegacyWorkspaceMergeResult, type KnowledgeLegacyWorkspaceMigrationResult } from './workspace-migration';
import { type KnowledgeProjectLinksAuthority } from './project-links';
export interface KnowledgeServiceOptions {
    scope?: string;
    cwd?: string;
    projectLinksAuthority?: KnowledgeProjectLinksAuthority;
    projectLinksIdentity?: {
        authorityId?: string;
        tenantId?: string;
        corpusId?: string;
    };
}
export interface KnowledgePathsResult {
    ok: true;
    scope: string;
    home: string;
    exists: boolean;
    config_path: string;
    config_exists: boolean;
    json_store_path: string;
    json_store_exists: boolean;
    knowledge_db_path: string;
    knowledge_db_exists: boolean;
    artifacts_dir: string;
    indexes_dir: string;
    logs_dir: string;
    runs_dir: string;
    schemas_dir: string;
    wiki_dir: string;
    config: KnowledgeConfig;
    message: string;
}
export interface KnowledgeInventoryOptions {
    limit?: number;
    storePath?: string;
    includeArchived?: boolean;
}
export interface KnowledgeInventoryLegacyItem {
    id: string;
    short_id: string | null;
    title: string;
    content_preview: string;
    url: string | null;
    tags: string[];
    metadata: Record<string, unknown>;
    archived: boolean;
    created_at: string;
    updated_at: string;
}
export interface KnowledgeInventoryResult {
    ok: true;
    scope: string;
    home: string;
    limit: number;
    paths: {
        json_store_path: string;
        json_store_exists: boolean;
        knowledge_db_path: string;
        knowledge_db_exists: boolean;
        artifacts_dir: string;
        indexes_dir: string;
        logs_dir: string;
        wiki_dir: string;
    };
    summary: Record<string, number>;
    legacy_store: {
        path: string;
        exists: boolean;
        read_error: string | null;
        total_items: number;
        active_items: number;
        archived_items: number;
        items_returned: number;
    };
    items: KnowledgeInventoryLegacyItem[];
    sources: Array<Record<string, unknown>>;
    source_revisions: Array<Record<string, unknown>>;
    chunks: Array<Record<string, unknown>>;
    wiki_pages: Array<Record<string, unknown>>;
    indexes: Array<Record<string, unknown>>;
    storage_objects: Array<Record<string, unknown>>;
    runs: Array<Record<string, unknown>>;
    vector_indexes: Array<Record<string, unknown>>;
    reindex_queue: Array<Record<string, unknown>>;
    machines: Array<Record<string, unknown>>;
    sync_conflicts: Array<Record<string, unknown>>;
    approval_gates: Array<Record<string, unknown>>;
    audit_events: Array<Record<string, unknown>>;
    promotion_candidates: Array<Record<string, unknown>>;
    durable_records: Array<Record<string, unknown>>;
    message: string;
}
export interface KnowledgeSetupResult {
    ok: true;
    storage_type: KnowledgeConfig['storage']['type'];
    artifact_uri_prefix: string;
    canonical_example: StorageContract['canonical_example'];
    config_path: string;
    next: string[];
    message: string;
}
export type KnowledgeLegacyPathMigrationResult = KnowledgeLegacyWorkspaceMigrationResult;
export type KnowledgeLegacyPathMergeResult = KnowledgeLegacyWorkspaceMergeResult;
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
        cacheability: KnowledgeMachineRouteResolution['cacheability'];
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
    modified_time: {
        with_modified_at: number;
        missing_modified_at: number;
        invalid_modified_at: number;
        examples: string[];
    };
    provenance: {
        with_provenance: number;
        missing_provenance: number;
        with_artifact_key: number;
        missing_artifact_key: number;
        artifact_key_mismatches: number;
        generated_from: Array<{
            value: string;
            count: number;
        }>;
        examples: string[];
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
        tracks_modified_time: boolean;
        preserves_provenance: boolean;
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
export interface KnowledgeRulesProvenanceImportOptions {
    root?: string;
    owner?: string;
    dryRun?: boolean;
    deprecateLegacy?: boolean;
    includeLegacy?: boolean;
    maxItems?: number;
    limit?: number;
}
export type KnowledgeRulesProvenanceImportResult = RulesProvenanceImportResult;
export interface KnowledgeAppWikiWriteOptions {
    allowGlobal?: boolean;
}
export interface KnowledgeAppWikiNoteInput extends KnowledgeAppWikiWriteOptions {
    title: string;
    content: string;
    tags?: string[];
    sourceRefs?: string[];
    path?: string;
    metadata?: Record<string, unknown>;
}
export interface KnowledgeAppWikiSourceInput extends KnowledgeAppWikiWriteOptions {
    sourceRef: string;
    purpose?: string;
}
export type KnowledgeAppWikiInitResult = AppWikiInitResult;
export type KnowledgeAppWikiNoteResult = AppWikiNoteWriteResult;
export type KnowledgeAppWikiNote = AppWikiNoteRecord;
export type KnowledgeAppWikiNoteReadResult = AppWikiNoteGetResult;
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
export declare class KnowledgeSemanticSearchUnavailableError extends Error {
    readonly code = "semantic_query_unavailable";
    constructor();
}
export declare class KnowledgeService {
    private readonly options;
    private ensuredWorkspace?;
    private cachedConfig?;
    private cachedProjectLinksAuthority?;
    constructor(options?: KnowledgeServiceOptions);
    get scope(): string;
    get workspace(): KnowledgeWorkspace;
    ensureWorkspace(): KnowledgeWorkspace;
    jsonStorePath(): string;
    /**
     * The single knowledge-item Store for this scope. One interface, two
     * transports resolved from the environment: LocalItemStore (on-box db.json)
     * on-box by default, ApiItemStore (HTTP `/v1` + bearer key) when selected.
     * EVERY item read/write — CLI, MCP, and SDK — routes through this one
     * surface, so no path touches sqlite or the raw HTTP client directly.
     */
    itemStore(): ItemStore;
    /**
     * Package-owned Projects resource-link producer.
     *
     * SQLite-backed operation keeps aggregate membership and immutable receipts in the
     * existing knowledge.db SQLite catalog while resolving item bodies through
     * the same JSON ItemStore used by CLI/MCP/SDK. Shared access routes through
     * the authenticated HTTP producer, never a local mirror.
     */
    projectLinksAuthority(): KnowledgeProjectLinksAuthority;
    close(): Promise<void>;
    /** Bounded list query via the unified Store. */
    listItems(options?: ItemListOptions): Promise<ItemListResult>;
    /** Fetch one knowledge item by id or short id via the unified Store. */
    getItem(idOrShort: string): Promise<KnowledgeItem | null>;
    /** Create (or upsert on a caller-supplied id) an item via the unified Store. */
    createItem(input: ItemCreateInput): Promise<KnowledgeItem>;
    /** Patch an item by id or short id via the unified Store. */
    updateItem(idOrShort: string, patch: ItemPatch): Promise<KnowledgeItem | null>;
    /** Delete one item by id or short id via the unified Store. */
    deleteItem(idOrShort: string): Promise<boolean>;
    /** Delete many items by id/short id via the unified Store; returns the count. */
    deleteItems(idsOrShorts: string[]): Promise<number>;
    /**
     * Unified inventory dispatch: the server API knowledge-item corpus when the
     * HTTP transport is selected, the on-box sqlite/JSON catalog otherwise. CLI, MCP,
     * and SDK all call this so no surface reads a divergent store.
     */
    resolveInventory(options?: KnowledgeInventoryOptions): Promise<KnowledgeInventoryResult>;
    config(options?: {
        ensure?: boolean;
    }): KnowledgeConfig;
    safetyPolicy(): SafetyPolicy;
    artifactStore(): import("./artifact-store").ArtifactStore;
    storageContract(): StorageContract;
    validateStorage(): StorageValidationResult;
    assertStorageValid(action: string): void;
    migrateLegacyPath(options?: {
        approveWrite?: boolean;
        approvedBy?: string;
    }): KnowledgeLegacyPathMigrationResult;
    /**
     * One-time migration of the previous project-scoped workspace
     * (<cwd>/.hasna/knowledge) into the canonical project home
     * (~/.hasna/knowledge/projects/<key>). Dry-run by default; requires
     * --approve-write --approved-by to move. Reuses the same backup, verify,
     * move, verify and tombstone machinery as migrate-legacy-path. Refuses when
     * the canonical project home already contains data.
     */
    migrateProjectPath(options?: {
        approveWrite?: boolean;
        approvedBy?: string;
    }): KnowledgeLegacyPathMigrationResult;
    mergeLegacyPath(options?: {
        approveWrite?: boolean;
        approvedBy?: string;
    }): KnowledgeLegacyWorkspaceMergeResult;
    setup(options?: {
        canonicalExample?: boolean;
    }): KnowledgeSetupResult;
    authStatus(env?: Record<string, string | undefined>): KnowledgeAuthStatus;
    /**
     * Live authentication probe (one authenticated `/v1/notes?limit=1` request
     * through the read-path transport). whoami/status overlay this on
     * {@link authStatus} so a revoked key reports `authenticated: false` instead
     * of a presence-based claim.
     */
    probeAuth(env?: Record<string, string | undefined>): Promise<KnowledgeAuthProbe>;
    saveAuth(input: {
        apiKey: string;
        email?: string;
        orgId?: string;
        orgSlug?: string;
        userId?: string;
        apiUrl?: string;
    }, env?: Record<string, string | undefined>): import("./auth").KnowledgeAuthConfig;
    clearAuth(env?: Record<string, string | undefined>): boolean;
    paths(): KnowledgePathsResult;
    initDb(): {
        path: string;
        schema_version: number;
    };
    dbStats(): import("./knowledge-db").KnowledgeDbStats;
    enqueuePromotion(input: EnqueueKnowledgePromotionInput): {
        created: boolean;
        candidate: KnowledgePromotionCandidate;
    };
    promotionInbox(options?: {
        status?: KnowledgePromotionStatus | 'inbox';
        kind?: KnowledgePromotionKind;
        limit?: number;
    }): KnowledgePromotionCandidate[];
    getPromotion(id: string): KnowledgePromotionCandidate | null;
    reviewPromotion(id: string, now?: Date): KnowledgePromotionCandidate;
    promoteCandidate(id: string, options?: PromoteKnowledgeCandidateOptions): {
        ok: boolean;
        promoted: boolean;
        requires_approval: boolean;
        candidate: KnowledgePromotionCandidate;
        record: DurableKnowledgeRecord | null;
        approval_id: string | null;
        reason: string | null;
    };
    rejectPromotion(id: string, options?: {
        rejectedBy?: string;
        now?: Date;
    }): KnowledgePromotionCandidate;
    durableRecords(options?: {
        kind?: KnowledgePromotionKind;
        status?: string;
        limit?: number;
    }): DurableKnowledgeRecord[];
    /**
     * Build a knowledge inventory from a bare item list (no local sqlite catalog).
     * Shared by the local no-db path and the HTTP path so both produce the exact
     * same KnowledgeInventoryResult shape with empty catalog sections.
     */
    private itemOnlyInventory;
    /**
     * HTTP inventory reports the shared server knowledge-item corpus.
     * The RAG catalog (sources/chunks/wiki/sync/machines) lives only in the local
     * sqlite pipeline and has no HTTP counterpart, so those sections are empty —
     * this routes through the same HTTP item transport every item command uses,
     * never the local db.json or sqlite catalog.
     */
    httpInventory(options?: KnowledgeInventoryOptions): Promise<KnowledgeInventoryResult>;
    inventory(options?: KnowledgeInventoryOptions): KnowledgeInventoryResult;
    private assertAppWikiWrite;
    initAppWiki(options?: KnowledgeAppWikiWriteOptions): Promise<KnowledgeAppWikiInitResult>;
    addAppWikiNote(options: KnowledgeAppWikiNoteInput): Promise<KnowledgeAppWikiNoteResult>;
    listAppWikiNotes(options?: {
        limit?: number;
    }): KnowledgeAppWikiNote[];
    getAppWikiNote(id: string, options?: {
        includeContent?: boolean;
    }): Promise<KnowledgeAppWikiNoteReadResult | null>;
    addAppWikiSourceRef(options: KnowledgeAppWikiSourceInput): Promise<import("./source-ingest").SourceIngestResult>;
    searchAppWiki(options: Omit<HybridSearchOptions, 'dbPath' | 'config'>): Promise<HybridSearchResult>;
    queryAppWiki(options: Omit<RetrievalOptions, 'dbPath' | 'config'>): Promise<KnowledgeContextPack>;
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
    importRulesProvenance(options?: KnowledgeRulesProvenanceImportOptions): Promise<KnowledgeRulesProvenanceImportResult>;
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
    /** True when canonical client configuration resolves to HTTP transport. */
    private usesHttpTransport;
    private httpStore;
    /** Fetch the entire shared knowledge-item corpus from the HTTP API. */
    private fetchHttpItems;
    semanticSearch(options: Omit<EmbeddingSearchOptions, 'dbPath' | 'config'>): Promise<import("./embeddings").SemanticSearchResult>;
    search(options: Omit<HybridSearchOptions, 'dbPath' | 'config'>): Promise<HybridSearchResult>;
    retrieveContext(options: Omit<RetrievalOptions, 'dbPath' | 'config'>): Promise<KnowledgeContextPack>;
    contextPack(options: Omit<KnowledgeAgentContextPackOptions, 'dbPath' | 'config' | 'safetyPolicy'>): Promise<KnowledgeAgentContextPack>;
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
    syncMachines(): KnowledgeSyncMachineRow[];
    exportSyncBundle(options?: KnowledgeSyncBundleOptions): KnowledgeSyncBundle;
    importSyncBundle(options: KnowledgeSyncImportOptions): Promise<KnowledgeSyncApplyResult>;
    syncRemotePeer(options: KnowledgeRemotePeerSyncOptions): Promise<KnowledgeRemotePeerSyncResult>;
    syncPeer(options: KnowledgePeerSyncOptions): Promise<KnowledgePeerSyncResult>;
}
export declare function createKnowledgeService(options?: KnowledgeServiceOptions): KnowledgeService;
