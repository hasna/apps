export type KnowledgePromotionKind = 'lesson' | 'decision' | 'claim';
export type KnowledgePromotionSourceKind = 'memento' | 'session' | 'report';
export type KnowledgePromotionStatus = 'ready' | 'needs_approval' | 'blocked' | 'duplicate' | 'promoted' | 'rejected';
export interface KnowledgePromotionEvidenceRefInput {
    ref: string;
    citation_id?: string | null;
    chunk_id?: string | null;
    revision?: string | null;
    hash?: string | null;
    observed_at?: string | null;
    expires_at?: string | null;
    status?: string | null;
}
export interface KnowledgePromotionEvidenceRef {
    ref: string;
    citation_id: string | null;
    chunk_id: string | null;
    revision: string | null;
    hash: string | null;
    observed_at: string | null;
    expires_at: string | null;
    status: string | null;
}
export interface KnowledgePromotionCitationCheck {
    ref: string;
    valid: boolean;
    resolved_by: 'citation' | 'chunk' | 'source' | 'run' | 'external_uri' | 'none';
    stale: boolean;
    reason: string | null;
}
export interface KnowledgePromotionChecks {
    citations: {
        provided: number;
        valid: number;
        invalid: number;
        entries: KnowledgePromotionCitationCheck[];
    };
    invalid_source_refs: string[];
    stale_refs: string[];
    duplicate_record_ids: string[];
    duplicate_candidate_ids: string[];
    conflicting_record_ids: string[];
    conflicting_candidate_ids: string[];
    approval_reasons: string[];
}
export interface KnowledgePromotionCandidate {
    id: string;
    record_kind: KnowledgePromotionKind;
    title: string;
    content: string;
    canonical_key: string;
    content_hash: string;
    source_kind: KnowledgePromotionSourceKind;
    source_refs: string[];
    evidence_refs: KnowledgePromotionEvidenceRef[];
    status: KnowledgePromotionStatus;
    requires_approval: boolean;
    checks: KnowledgePromotionChecks;
    idempotency_key: string;
    duplicate_of: string | null;
    approved_by: string | null;
    promoted_record_id: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    reviewed_at: string | null;
    promoted_at: string | null;
}
export interface DurableKnowledgeRecord {
    id: string;
    record_kind: KnowledgePromotionKind;
    title: string;
    content: string;
    canonical_key: string;
    content_hash: string;
    status: string;
    source_refs: string[];
    evidence_refs: KnowledgePromotionEvidenceRef[];
    confidence: number | null;
    valid_from: string;
    valid_to: string | null;
    promoted_from_candidate_id: string;
    approved_by: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}
export interface EnqueueKnowledgePromotionInput {
    kind: KnowledgePromotionKind;
    title: string;
    content: string;
    sourceKind: KnowledgePromotionSourceKind;
    sourceRefs: string[];
    evidenceRefs: Array<string | KnowledgePromotionEvidenceRefInput>;
    canonicalKey?: string;
    requiresApproval?: boolean;
    confidence?: number;
    validFrom?: string;
    validTo?: string | null;
    metadata?: Record<string, unknown>;
    now?: Date;
}
export interface PromoteKnowledgeCandidateOptions {
    approveWrite?: boolean;
    approvedBy?: string;
    now?: Date;
}
export declare function enqueueKnowledgePromotion(dbPath: string, input: EnqueueKnowledgePromotionInput): {
    created: boolean;
    candidate: KnowledgePromotionCandidate;
};
export declare function getKnowledgePromotion(dbPath: string, id: string): KnowledgePromotionCandidate | null;
export declare function listKnowledgePromotions(dbPath: string, options?: {
    status?: KnowledgePromotionStatus | 'inbox';
    kind?: KnowledgePromotionKind;
    limit?: number;
}): KnowledgePromotionCandidate[];
export declare function reviewKnowledgePromotion(dbPath: string, id: string, now?: Date): KnowledgePromotionCandidate;
export declare function promoteKnowledgeCandidate(dbPath: string, id: string, options?: PromoteKnowledgeCandidateOptions): {
    ok: boolean;
    promoted: boolean;
    requires_approval: boolean;
    candidate: KnowledgePromotionCandidate;
    record: DurableKnowledgeRecord | null;
    approval_id: string | null;
    reason: string | null;
};
export declare function rejectKnowledgePromotion(dbPath: string, id: string, options?: {
    rejectedBy?: string;
    now?: Date;
}): KnowledgePromotionCandidate;
export declare function listDurableKnowledgeRecords(dbPath: string, options?: {
    kind?: KnowledgePromotionKind;
    status?: string;
    limit?: number;
}): DurableKnowledgeRecord[];
