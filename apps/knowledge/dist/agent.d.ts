import { type KnowledgeContextPack, type RetrievalOptions } from './retrieval';
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
