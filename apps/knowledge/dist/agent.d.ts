import { type KnowledgeContextPack, type RetrievalOptions } from './retrieval';
import type { KnowledgeItem } from './store';
export interface KnowledgePromptOptions extends Omit<RetrievalOptions, 'query'> {
    prompt: string;
    generate?: boolean;
    approveWrite?: boolean;
    now?: Date;
}
export interface KnowledgePromptResult {
    run_id: string;
    prompt: string;
    generated: boolean;
    provider: string;
    model: string;
    answer: string;
    context: KnowledgeContextPack;
    citations: KnowledgeContextPack['citations'];
    proposed_wiki_updates: Array<{
        kind: 'answer_note';
        title: string;
        citations: string[];
        requires_approval: boolean;
    }>;
    write_policy: {
        approved: boolean;
        durable_writes_performed: false;
        reason: string;
    };
    usage: {
        input_tokens: number;
        output_tokens: number;
        cost_usd: number;
    };
    warnings: string[];
}
export declare function runKnowledgePrompt(options: KnowledgePromptOptions): Promise<KnowledgePromptResult>;
export interface KnowledgePromptOverItemsOptions extends Omit<KnowledgePromptOptions, 'dbPath' | 'legacyStorePath'> {
}
/**
 * Run an `ask`/`build` prompt against an in-memory knowledge-item corpus — the
 * api (self_hosted / cloud) path. Retrieval reads the shared cloud items (fetched
 * through the item Store); the LLM runs client-side with the caller's provider
 * key. There is no local sqlite catalog, so run telemetry is not persisted to a
 * local db (it would be split-brain); the run id is still returned for the shape.
 */
export declare function runKnowledgePromptOverItems(items: KnowledgeItem[], options: KnowledgePromptOverItemsOptions): Promise<KnowledgePromptResult>;
