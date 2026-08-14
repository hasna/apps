import { type RetrievalOptions } from './retrieval';
import { type SafetyPolicy } from './safety';
import type { KnowledgeConfig } from './workspace';
export type KnowledgeContextPackSource = 'search' | 'loops' | 'runs';
export type KnowledgeContextPackPurpose = 'agent_context' | 'proposal';
export interface KnowledgeAgentContextPackOptions extends Omit<RetrievalOptions, 'dbPath' | 'config' | 'query'> {
    dbPath: string;
    config?: KnowledgeConfig;
    safetyPolicy?: SafetyPolicy;
    source?: KnowledgeContextPackSource;
    purpose?: KnowledgeContextPackPurpose;
    query?: string;
    topic?: string;
    since?: string;
    dedupe?: boolean;
    maxTokens?: number;
    maxItems?: number;
    now?: Date;
}
export interface KnowledgeAgentContextCitation {
    id: string;
    kind: 'source' | 'artifact' | 'run' | 'run_event';
    ref: string;
    source_ref: string | null;
    source_uri: string | null;
    artifact_uri: string | null;
    artifact_path: string | null;
    run_id: string | null;
    run_event_id: string | null;
    revision: string | null;
    hash: string | null;
    chunk_id: string | null;
    offsets: {
        start: number | null;
        end: number | null;
    };
    quote_preview: string | null;
}
export interface KnowledgeAgentContextEvidence {
    id: string;
    kind: string;
    title: string;
    text_preview: string;
    score: number;
    citation_ids: string[];
    provenance: {
        source: KnowledgeContextPackSource;
        record_ref: string;
        created_at: string | null;
        updated_at: string | null;
        metadata_keys: string[];
    };
}
export interface KnowledgeAgentDuplicateCandidate {
    id: string;
    reason: 'normalized_text_match';
    evidence_ids: string[];
    confidence: 'high' | 'medium';
}
export interface KnowledgeAgentContextPack {
    ok: true;
    format: 'knowledge-agent-context-pack';
    version: 1;
    created_at: string;
    source: KnowledgeContextPackSource;
    purpose: KnowledgeContextPackPurpose;
    query: string;
    topic: string | null;
    since: string | null;
    dry_run: true;
    idempotency_key: string;
    budgets: {
        max_tokens: number;
        estimated_tokens: number;
        max_items: number;
        items_included: number;
        items_available: number;
        items_truncated: number;
        token_budget_exceeded: boolean;
    };
    safety: {
        raw_artifact_content_included: false;
        durable_writes_performed: false;
        redactions: number;
        reminders: string[];
    };
    citations: KnowledgeAgentContextCitation[];
    evidence: KnowledgeAgentContextEvidence[];
    duplicate_candidates: KnowledgeAgentDuplicateCandidate[];
    outline: {
        title: string;
        bullets: string[];
        evidence_ids: string[];
        duplicate_candidate_ids: string[];
        next_actions: string[];
    };
    warnings: string[];
    message: string;
}
export declare function buildKnowledgeAgentContextPack(options: KnowledgeAgentContextPackOptions): Promise<KnowledgeAgentContextPack>;
