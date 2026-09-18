import type { KnowledgeItem } from './store.js';
import { KNOWLEDGE_GUARDED_WRITE_CONTRACT, type KnowledgeGuardedBinding, type KnowledgeGuardedBounds, type KnowledgePrivateItemProof } from './guarded-write-contract.js';
export declare const KNOWLEDGE_PRIVATE_REVIEW_SCHEMA: "hasna.knowledge.private-review.v1";
export type KnowledgeReviewBindingState = 'legacy_unbound' | 'bound_to_requested';
export interface CreateKnowledgePrivateReviewDescriptorOptions {
    operation_id: string;
    step_id: string;
    binding: KnowledgeGuardedBinding;
    target_id: string;
    expected_version: number;
    expected_content_sha256: string;
    expected_binding_state: KnowledgeReviewBindingState;
    expires_in_ms?: number;
}
export interface KnowledgePrivateReviewRequest {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    schema: typeof KNOWLEDGE_PRIVATE_REVIEW_SCHEMA;
    operation_id: string;
    step_id: string;
    binding: KnowledgeGuardedBinding;
    target_id: string;
    expected_version: number;
    expected_content_sha256: string;
    expected_binding_state: KnowledgeReviewBindingState;
    expires_at: string;
}
export interface KnowledgePrivateReviewDescriptor extends Readonly<KnowledgePrivateReviewRequest> {
    readonly descriptor_id: string;
    toJSON(): KnowledgePrivateReviewRequest;
}
export interface KnowledgePrivateReviewEnvelope {
    descriptor: KnowledgePrivateReviewRequest;
    limits: KnowledgeGuardedBounds;
}
export interface KnowledgePrivateReviewProof {
    contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
    kind: 'review';
    item_count: 1;
    request_digest: string;
    binding_state: KnowledgeReviewBindingState;
    item: KnowledgePrivateItemProof;
}
export type KnowledgePrivateReviewer = (item: Readonly<KnowledgeItem>) => void | Promise<void>;
export declare class KnowledgePrivateReviewError extends Error {
    readonly code: string;
    readonly status?: number;
    constructor(code: string, status?: number);
}
export declare function createKnowledgePrivateReviewDescriptor(options: CreateKnowledgePrivateReviewDescriptorOptions): KnowledgePrivateReviewDescriptor;
