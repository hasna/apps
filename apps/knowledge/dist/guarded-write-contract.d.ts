import type { KnowledgeItem, KnowledgeItemVersion } from './store.js';
export declare const KNOWLEDGE_GUARDED_WRITE_CONTRACT: "FCAME-1";
export declare const KNOWLEDGE_PRIVATE_INPUT_SCHEMA: "hasna.knowledge.private-input.v1";
export declare const KNOWLEDGE_PRIVATE_TITLE_LOOKUP_SCHEMA: "hasna.knowledge.private-title-lookup.v1";
export declare const KNOWLEDGE_PRIVATE_QUERY_SCHEMA: "hasna.knowledge.private-query.v1";
export declare const KNOWLEDGE_PRIVATE_RESULT_SCHEMA: "hasna.knowledge.private-result.v1";
export declare const KNOWLEDGE_RELATIONS_SCHEMA: "hasna.knowledge.relations.v1";
export declare const KNOWLEDGE_RELATIONS_METADATA_KEY: "hasna_knowledge_relations";
export type KnowledgeAuthorityClassification = 'user_hosted' | 'hasna_saas';
export type KnowledgeGuardedWriteVerb = 'create' | 'update';
export interface KnowledgeAuthorityBinding {
    classification: KnowledgeAuthorityClassification;
    authority_id: string;
}
export interface KnowledgeGuardedBinding {
    authority: KnowledgeAuthorityBinding;
    tenant_id: string;
    scope: string;
    parent_id: string;
}
export type KnowledgeGuardedBindingState = 'legacy_unbound' | 'bound_to_requested' | 'bound_elsewhere';
export interface KnowledgeGuardedBindingStateReadback {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    exact: true;
    bounded: true;
    item_count: 1;
    target_id: string;
    state: KnowledgeGuardedBindingState;
    /**
     * Returned only for legacy-unbound or exact requested-binding rows. A row
     * bound elsewhere is distinguishable without disclosing its version/hash.
     */
    item_version: number | null;
    content_sha256: string | null;
    limits: KnowledgeGuardedBounds;
}
export type KnowledgeGuardedAdoptionAction = 'adopt' | 'rollback';
export interface KnowledgeGuardedLegacyAdoptionOptions {
    operation_id: string;
    step_id: string;
    target_id: string;
    expected_version: number;
    expected_content_sha256: string;
}
export interface KnowledgeGuardedLegacyRollbackOptions {
    operation_id: string;
    step_id: string;
    adoption_receipt: KnowledgeGuardedAdoptionReceipt;
}
export interface KnowledgeGuardedAdoptionEnvelope {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    action: KnowledgeGuardedAdoptionAction;
    deterministic_key: string;
    operation_id: string;
    step_id: string;
    target_id: string;
    binding: KnowledgeGuardedBinding;
    expected_version: number;
    expected_content_sha256: string;
    adoption_receipt_id: string | null;
    limits: KnowledgeGuardedLimits;
}
export interface KnowledgeGuardedAdoptionReceipt {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    receipt_id: string;
    deterministic_key: string;
    action: KnowledgeGuardedAdoptionAction;
    operation_id: string;
    step_id: string;
    target_id: string;
    binding: KnowledgeGuardedBinding;
    expected_version: number;
    expected_content_sha256: string;
    adoption_receipt_id: string | null;
    /** Tenant value present before adoption; restored by receipt-scoped rollback. */
    prior_tenant_id: string | null;
    status: KnowledgeGuardedReceiptStatus;
    code: string;
    effect_count: 0 | 1;
    result_version: number | null;
    result_content_sha256: string | null;
    created_at: string;
}
export interface KnowledgeGuardedAdoptionSubmission {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    deterministic_key: string;
    receipt: KnowledgeGuardedAdoptionReceipt;
    duplicate: boolean;
}
export interface KnowledgeGuardedAdoptionReconciliation {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    deterministic_key: string;
    operation_id: string;
    step_id: string;
    exact: true;
    bounded: true;
    receipt_count: 0 | 1;
    terminal_complete: boolean;
    receipt: KnowledgeGuardedAdoptionReceipt | null;
    limits: KnowledgeGuardedBounds;
}
export interface KnowledgeGuardedAdoptionResult {
    deterministic_key: string;
    duplicate: boolean;
    receipt: KnowledgeGuardedAdoptionReceipt;
    reconciliation: KnowledgeGuardedAdoptionReconciliation;
    binding_state: KnowledgeGuardedBindingStateReadback;
    readback: KnowledgeGuardedReadback;
}
export interface KnowledgeGuardedRollbackResult {
    deterministic_key: string;
    duplicate: boolean;
    receipt: KnowledgeGuardedAdoptionReceipt;
    reconciliation: KnowledgeGuardedAdoptionReconciliation;
    binding_state: KnowledgeGuardedBindingStateReadback;
}
export interface KnowledgeGuardedManifestBinding {
    manifest_id: string;
    ordinal: number;
    phase: 'primary' | 'recovery';
    compensates_receipt_id: string | null;
}
export type KnowledgeGuardedPrecondition = {
    kind: 'absent';
} | {
    kind: 'version';
    expected_version: number;
};
export interface KnowledgeGuardedBounds {
    /** One producer call per phase. Values other than one are refused. */
    max_calls: number;
    /** Exact single-result phases. Values other than one are refused. */
    max_items: number;
    /** Maximum UTF-8 request/response bytes for the phase. */
    max_bytes: number;
    /** Producer wall-clock limit for the phase. */
    wall_time_ms: number;
}
export interface KnowledgeGuardedLimits {
    submission: KnowledgeGuardedBounds;
    reconciliation: KnowledgeGuardedBounds;
    readback: KnowledgeGuardedBounds;
}
export interface KnowledgeGuardedCreatePayload {
    title: string;
    content?: string;
    url?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
}
export interface KnowledgeGuardedUpdatePayload {
    title?: string;
    content?: string;
    url?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
    archived?: boolean;
}
export type KnowledgeGuardedPayload = KnowledgeGuardedCreatePayload | KnowledgeGuardedUpdatePayload;
export interface KnowledgePrivateInputDescriptor {
    readonly contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    readonly schema: typeof KNOWLEDGE_PRIVATE_INPUT_SCHEMA;
    readonly descriptor_id: string;
    readonly operation_id: string;
    readonly step_id: string;
    readonly verb: KnowledgeGuardedWriteVerb;
    readonly target_id: string;
    readonly payload_digest: string;
    readonly binding_digest: string;
    readonly precondition: KnowledgeGuardedPrecondition;
    readonly binding: KnowledgeGuardedBinding;
    readonly manifest: KnowledgeGuardedManifestBinding | null;
    readonly expires_at: string;
    /**
     * JSON/log serialization is intentionally metadata-only. The private payload
     * lives in a module-private WeakMap and is never an enumerable property.
     */
    toJSON(): Omit<KnowledgePrivateInputDescriptor, 'toJSON'>;
}
export interface CreateKnowledgePrivateInputDescriptorOptions {
    operation_id: string;
    step_id: string;
    verb: KnowledgeGuardedWriteVerb;
    target_id: string;
    precondition: KnowledgeGuardedPrecondition;
    binding: KnowledgeGuardedBinding;
    /** Required when this write is one ordered step in a multi-record workflow. */
    manifest?: KnowledgeGuardedManifestBinding;
    payload: KnowledgeGuardedPayload;
    /** Defaults to five minutes; bounded to one hour. */
    expires_in_ms?: number;
}
export interface KnowledgePrivateTitleLookupDescriptor {
    readonly contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    readonly schema: typeof KNOWLEDGE_PRIVATE_TITLE_LOOKUP_SCHEMA;
    /** Process-private handle. Deliberately non-enumerable and omitted by toJSON. */
    readonly descriptor_id: string;
    readonly operation_id: string;
    readonly step_id: string;
    readonly title_digest: string;
    readonly binding_digest: string;
    readonly binding: KnowledgeGuardedBinding;
    readonly expires_at: string;
    toJSON(): Omit<KnowledgePrivateTitleLookupDescriptor, 'descriptor_id' | 'toJSON'>;
}
export interface CreateKnowledgePrivateTitleLookupDescriptorOptions {
    operation_id: string;
    step_id: string;
    binding: KnowledgeGuardedBinding;
    title: string;
    /** Defaults to five minutes; bounded to one hour. */
    expires_in_ms?: number;
}
export type KnowledgePrivateQueryKind = 'exact_title' | 'lexical_overlap' | 'semantic_overlap' | 'supersession' | 'current_version' | 'historical_version' | 'canonical_pointer';
export type KnowledgePrivateQuerySelector = {
    kind: 'exact_title';
    title: string;
} | {
    kind: 'lexical_overlap';
    query: string;
} | {
    kind: 'semantic_overlap';
    query: string;
} | {
    kind: 'supersession';
    supersedes_item_id: string;
} | {
    kind: 'current_version';
    item_id: string;
} | {
    kind: 'historical_version';
    item_id: string;
    version: number;
} | {
    kind: 'canonical_pointer';
    canonical_item_id: string;
};
export interface KnowledgeRelationsMetadata {
    schema: typeof KNOWLEDGE_RELATIONS_SCHEMA;
    supersedes_item_id?: string;
    canonical_item_id?: string;
}
export type KnowledgePrivateQueryArchive = 'active' | 'archived' | 'all';
export interface KnowledgePrivateQueryPage {
    limit: number;
    offset: number;
}
export interface KnowledgePrivateQueryBounds extends KnowledgeGuardedBounds {
    max_items: number;
}
export interface KnowledgePrivateQueryDescriptor {
    readonly contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    readonly schema: typeof KNOWLEDGE_PRIVATE_QUERY_SCHEMA;
    /** Process-private handle. Deliberately non-enumerable and omitted by toJSON. */
    readonly descriptor_id: string;
    readonly operation_id: string;
    readonly step_id: string;
    readonly query_kind: KnowledgePrivateQueryKind;
    readonly selector_digest: string;
    readonly binding_digest: string;
    readonly binding: KnowledgeGuardedBinding;
    readonly archive: KnowledgePrivateQueryArchive;
    readonly page: KnowledgePrivateQueryPage;
    readonly expires_at: string;
    toJSON(): Omit<KnowledgePrivateQueryDescriptor, 'descriptor_id' | 'toJSON'>;
}
export interface CreateKnowledgePrivateQueryDescriptorOptions {
    operation_id: string;
    step_id: string;
    binding: KnowledgeGuardedBinding;
    selector: KnowledgePrivateQuerySelector;
    archive?: KnowledgePrivateQueryArchive;
    limit?: number;
    offset?: number;
    /** Defaults to five minutes; bounded to one hour. */
    expires_in_ms?: number;
}
export interface KnowledgePrivateQueryEnvelope {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    descriptor: Omit<KnowledgePrivateQueryDescriptor, 'descriptor_id' | 'toJSON'>;
    selector: KnowledgePrivateQuerySelector;
    limits: KnowledgePrivateQueryBounds;
}
export interface KnowledgeGuardedTitleLookupEnvelope {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    descriptor: Omit<KnowledgePrivateTitleLookupDescriptor, 'descriptor_id' | 'toJSON'>;
    title: string;
    limits: KnowledgeGuardedBounds;
}
export interface KnowledgeGuardedWriteEnvelope {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    descriptor: Omit<KnowledgePrivateInputDescriptor, 'toJSON'>;
    deterministic_key: string;
    limits: KnowledgeGuardedLimits;
    payload: KnowledgeGuardedPayload;
}
export type KnowledgeGuardedRecoveryStrategy = 'forward_repair' | 'receipt_scoped_compensation';
export interface KnowledgeGuardedManifestRecovery {
    strategy: KnowledgeGuardedRecoveryStrategy;
    operation_id: string;
    step_id: string;
    deterministic_key: string;
    verb: KnowledgeGuardedWriteVerb;
    target_id: string;
    semantic_digest: string;
    precondition: KnowledgeGuardedPrecondition;
    binding: KnowledgeGuardedBinding;
    limits: KnowledgeGuardedLimits;
    /** Compensation may affect only the exact accepted receipt of this step. */
    receipt_scope: 'accepted_step_receipt' | null;
    compensates_receipt_id: string | null;
}
export interface KnowledgeGuardedManifestStep {
    ordinal: number;
    operation_id: string;
    step_id: string;
    deterministic_key: string;
    verb: KnowledgeGuardedWriteVerb;
    target_id: string;
    binding: KnowledgeGuardedBinding;
    semantic_digest: string;
    precondition: KnowledgeGuardedPrecondition;
    dependencies: number[];
    limits: KnowledgeGuardedLimits;
    recovery: KnowledgeGuardedManifestRecovery;
}
export interface CreateKnowledgeGuardedManifestOptions {
    manifest_id: string;
    operation_id: string;
    steps: KnowledgeGuardedManifestStep[];
}
export interface KnowledgeGuardedManifestEnvelope {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    maintainer: KnowledgeGuardedBinding;
    manifest: CreateKnowledgeGuardedManifestOptions;
    deterministic_key: string;
}
export interface KnowledgeGuardedManifest {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    manifest_receipt_id: string;
    manifest_id: string;
    operation_id: string;
    deterministic_key: string;
    manifest_digest: string;
    maintainer: KnowledgeGuardedBinding;
    step_count: number;
    steps: KnowledgeGuardedManifestStep[];
    created_at: string;
}
export interface KnowledgeGuardedManifestSubmission {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    deterministic_key: string;
    manifest: KnowledgeGuardedManifest;
    duplicate: boolean;
}
export type KnowledgeGuardedManifestStepState = 'accepted' | 'rejected' | 'missing' | 'unverified_external_authority';
export interface KnowledgeGuardedManifestReconciliationStep {
    ordinal: number;
    deterministic_key: string;
    authority: KnowledgeAuthorityBinding;
    state: KnowledgeGuardedManifestStepState;
    receipt: KnowledgeGuardedReceipt | null;
    recovery_deterministic_key: string;
    recovery_state: KnowledgeGuardedManifestStepState;
    recovery_receipt: KnowledgeGuardedReceipt | null;
}
export interface KnowledgeGuardedManifestReconciliation {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    manifest: KnowledgeGuardedManifest;
    exact: true;
    bounded: true;
    terminal_complete: boolean;
    accepted_complete: boolean;
    unsupported_gap: string | null;
    steps: KnowledgeGuardedManifestReconciliationStep[];
    limits: KnowledgeGuardedBounds;
}
export interface KnowledgeGuardedManifestCompletion {
    terminal_complete: boolean;
    accepted_complete: boolean;
}
export type KnowledgeGuardedReceiptStatus = 'accepted' | 'rejected';
export interface KnowledgeGuardedReceipt {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    receipt_id: string;
    deterministic_key: string;
    operation_id: string;
    step_id: string;
    verb: KnowledgeGuardedWriteVerb;
    target_id: string;
    authority: KnowledgeAuthorityBinding;
    tenant_id: string;
    scope: string;
    parent_id: string;
    payload_digest: string;
    precondition: KnowledgeGuardedPrecondition;
    manifest: KnowledgeGuardedManifestBinding | null;
    status: KnowledgeGuardedReceiptStatus;
    code: string;
    effect_count: 0 | 1;
    result_id: string | null;
    result_version: number | null;
    created_at: string;
}
export interface KnowledgeGuardedSubmission {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    deterministic_key: string;
    receipt: KnowledgeGuardedReceipt;
    duplicate: boolean;
}
export interface KnowledgeTerminalReconciliation {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    deterministic_key: string;
    operation_id: string;
    step_id: string;
    exact: true;
    bounded: true;
    receipt_count: 0 | 1;
    terminal_complete: boolean;
    receipt: KnowledgeGuardedReceipt | null;
    limits: KnowledgeGuardedBounds;
}
export interface KnowledgeGuardedReadback {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    exact: true;
    bounded: true;
    item_count: 1;
    binding: KnowledgeGuardedBinding;
    item: KnowledgeItem;
    limits: KnowledgeGuardedBounds;
}
export interface KnowledgeGuardedWriteResult {
    deterministic_key: string;
    duplicate: boolean;
    receipt: KnowledgeGuardedReceipt;
    reconciliation: KnowledgeTerminalReconciliation;
    readback: KnowledgeGuardedReadback;
}
export interface KnowledgePrivateItemProof {
    id: string;
    version: number;
    title_sha256: string;
    content_sha256: string;
    url_sha256: string | null;
    tags_sha256: string;
    metadata_sha256: string;
    archived: boolean;
}
export interface KnowledgePrivateQueryItemProof {
    /** The producer record id is private; only its digest crosses the result boundary. */
    id_sha256: string;
    version: number;
    title_sha256: string;
    content_sha256: string;
    url_sha256: string | null;
    tags_sha256: string;
    metadata_sha256: string;
    archived: boolean;
    record_kind: 'current' | 'historical';
    matched_value_sha256: string | null;
}
export interface KnowledgePrivateQueryResult {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    exact: true;
    bounded: true;
    private: true;
    query_kind: KnowledgePrivateQueryKind;
    status: 'available' | 'unavailable';
    code: null | 'semantic_query_unavailable';
    binding: KnowledgeGuardedBinding;
    selector_digest: string;
    total: number;
    item_count: number;
    page: {
        limit: number;
        offset: number;
        returned: number;
        has_more: boolean;
    };
    items: readonly KnowledgePrivateQueryItemProof[];
    limits: KnowledgePrivateQueryBounds;
}
export interface KnowledgeGuardedTitleLookup {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    exact: true;
    bounded: true;
    item_count: 0 | 1;
    binding: KnowledgeGuardedBinding;
    title_digest: string;
    items: readonly KnowledgePrivateItemProof[];
    limits: KnowledgeGuardedBounds;
}
export type KnowledgePrivateResultKind = 'write' | 'readback' | 'title_lookup' | 'query';
export interface KnowledgePrivateResultDescriptor {
    readonly contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    readonly schema: typeof KNOWLEDGE_PRIVATE_RESULT_SCHEMA;
    /** Process-private handle. Deliberately non-enumerable and omitted by toJSON. */
    readonly descriptor_id: string;
    readonly kind: KnowledgePrivateResultKind;
    readonly result_digest: string;
    readonly item_count: number;
    readonly expires_at: string;
    toJSON(): Omit<KnowledgePrivateResultDescriptor, 'descriptor_id' | 'toJSON'>;
}
export interface KnowledgePrivateResultProof {
    kind: KnowledgePrivateResultKind;
    item_count: number;
    items: readonly (KnowledgePrivateItemProof | KnowledgePrivateQueryItemProof)[];
    deterministic_key?: string;
    receipt_id?: string;
    duplicate?: boolean;
    query_kind?: KnowledgePrivateQueryKind;
    status?: KnowledgePrivateQueryResult['status'];
    code?: KnowledgePrivateQueryResult['code'];
    total?: number;
    page?: KnowledgePrivateQueryResult['page'];
}
export declare const DEFAULT_KNOWLEDGE_GUARDED_LIMITS: KnowledgeGuardedLimits;
export declare function assertKnowledgeGuardedBinding(binding: KnowledgeGuardedBinding): void;
export declare function assertKnowledgeGuardedPrecondition(verb: KnowledgeGuardedWriteVerb, precondition: KnowledgeGuardedPrecondition): void;
export declare function assertKnowledgeGuardedManifestBinding(manifest: KnowledgeGuardedManifestBinding): void;
export declare function assertKnowledgeGuardedBounds(bounds: KnowledgeGuardedBounds, field?: string): void;
export declare function assertKnowledgePrivateQueryBounds(bounds: KnowledgePrivateQueryBounds, field?: string): void;
export declare function assertKnowledgePrivateQueryPage(page: KnowledgePrivateQueryPage, bounds: KnowledgePrivateQueryBounds): void;
export declare function assertKnowledgePrivateQuerySelector(selector: KnowledgePrivateQuerySelector): void;
export declare function assertKnowledgeRelationsMetadata(metadata: Record<string, unknown>, itemId?: string): void;
export declare function normalizeKnowledgeGuardedLimits(limits?: Partial<KnowledgeGuardedLimits>): KnowledgeGuardedLimits;
export declare function canonicalKnowledgeGuardedJson(value: unknown): string;
export declare function knowledgeGuardedDigest(value: unknown): string;
export declare function knowledgeGuardedContentSha256(content: string): string;
export interface KnowledgeGuardedAdoptionKeyInput {
    action: KnowledgeGuardedAdoptionAction;
    operation_id: string;
    step_id: string;
    target_id: string;
    binding: KnowledgeGuardedBinding;
    expected_version: number;
    expected_content_sha256: string;
    adoption_receipt_id?: string | null;
}
export declare function computeKnowledgeGuardedAdoptionDeterministicKey(input: KnowledgeGuardedAdoptionKeyInput): string;
export declare function computeKnowledgeGuardedAdoptionReceiptId(deterministicKey: string): string;
export interface KnowledgeGuardedDeterministicKeyInput {
    binding: KnowledgeGuardedBinding;
    operation_id: string;
    step_id: string;
    verb: KnowledgeGuardedWriteVerb;
    target_id: string;
    payload_digest: string;
    precondition: KnowledgeGuardedPrecondition;
    manifest?: KnowledgeGuardedManifestBinding | null;
}
/**
 * Deterministic key:
 * sha256(canonical JSON of the FCAME-1 authority/tenant/scope/parent,
 * operation/step, verb/target, private-payload digest, and precondition tuple).
 */
export declare function computeKnowledgeGuardedDeterministicKey(input: KnowledgeGuardedDeterministicKeyInput): string;
export interface KnowledgeGuardedRecoveryKeyInput {
    manifest_id: string;
    ordinal: number;
    step_deterministic_key: string;
    strategy: KnowledgeGuardedRecoveryStrategy;
    operation_id: string;
    step_id: string;
    verb: KnowledgeGuardedWriteVerb;
    target_id: string;
    semantic_digest: string;
    precondition: KnowledgeGuardedPrecondition;
    binding: KnowledgeGuardedBinding;
    limits: KnowledgeGuardedLimits;
    receipt_scope: 'accepted_step_receipt' | null;
    compensates_receipt_id: string | null;
}
export declare function computeKnowledgeGuardedRecoveryKey(input: KnowledgeGuardedRecoveryKeyInput): string;
export declare function computeKnowledgeGuardedReceiptId(deterministicKey: string): string;
/**
 * Globally collision-resistant manifest identity scoped to its maintaining
 * authority/tenant/scope/parent and stable workflow operation id.
 */
export declare function computeKnowledgeGuardedManifestId(maintainer: KnowledgeGuardedBinding, operationId: string): string;
export declare function assertKnowledgeGuardedManifestOptions(maintainer: KnowledgeGuardedBinding, options: CreateKnowledgeGuardedManifestOptions): void;
export declare function computeKnowledgeGuardedManifestDigest(maintainer: KnowledgeGuardedBinding, options: CreateKnowledgeGuardedManifestOptions): string;
export declare function computeKnowledgeGuardedManifestDeterministicKey(maintainer: KnowledgeGuardedBinding, options: CreateKnowledgeGuardedManifestOptions): string;
export declare function assertKnowledgeGuardedPayload(verb: KnowledgeGuardedWriteVerb, payload: KnowledgeGuardedPayload): void;
export declare function createKnowledgePrivateInputDescriptor(options: CreateKnowledgePrivateInputDescriptorOptions): KnowledgePrivateInputDescriptor;
export declare function revokeKnowledgePrivateInputDescriptor(descriptor: KnowledgePrivateInputDescriptor): void;
export declare function createKnowledgePrivateTitleLookupDescriptor(options: CreateKnowledgePrivateTitleLookupDescriptorOptions): KnowledgePrivateTitleLookupDescriptor;
export declare function revokeKnowledgePrivateTitleLookupDescriptor(descriptor: KnowledgePrivateTitleLookupDescriptor): void;
export declare function createKnowledgePrivateQueryDescriptor(options: CreateKnowledgePrivateQueryDescriptorOptions): KnowledgePrivateQueryDescriptor;
export declare function revokeKnowledgePrivateQueryDescriptor(descriptor: KnowledgePrivateQueryDescriptor): void;
export declare function knowledgePrivateItemProof(item: KnowledgeItem): KnowledgePrivateItemProof;
export declare function knowledgePrivateQueryItemProof(item: KnowledgeItem, matchedValue?: string | null): KnowledgePrivateQueryItemProof;
export declare function knowledgePrivateHistoricalQueryItemProof(item: KnowledgeItemVersion, matchedValue?: string | null): KnowledgePrivateQueryItemProof;
export declare function revokeKnowledgePrivateResultDescriptor(descriptor: KnowledgePrivateResultDescriptor): void;
export declare function inspectKnowledgePrivateResult(descriptor: KnowledgePrivateResultDescriptor): KnowledgePrivateResultProof;
export declare function assertKnowledgeTerminalCompleteness(reconciliation: KnowledgeTerminalReconciliation, expected: {
    deterministic_key: string;
    operation_id: string;
    step_id: string;
}): KnowledgeGuardedReceipt;
export declare function evaluateKnowledgeGuardedManifestCompletion(steps: readonly KnowledgeGuardedManifestReconciliationStep[]): KnowledgeGuardedManifestCompletion;
export declare function assertKnowledgeGuardedManifestTerminalCompleteness(reconciliation: KnowledgeGuardedManifestReconciliation, expected: {
    manifest_id: string;
    deterministic_key?: string;
    require_accepted?: boolean;
}): KnowledgeGuardedManifest;
export declare function knowledgeGuardedUtf8Bytes(value: unknown): number;
