import { type AiProviderId } from './providers';
import { type SafetyPolicy } from './safety';
import type { KnowledgeConfig } from './workspace';
export interface WebSearchOptions {
    dbPath: string;
    query: string;
    config?: KnowledgeConfig;
    safetyPolicy?: SafetyPolicy;
    modelRef?: string;
    provider?: AiProviderId;
    limit?: number;
    maxUses?: number;
    domains?: string[];
    fake?: boolean;
    fileResults?: boolean;
    env?: Record<string, string | undefined>;
    now?: Date;
}
export interface WebSearchSource {
    url: string;
    title: string | null;
    snippet: string | null;
    provider_metadata: Record<string, unknown>;
}
export interface WebSearchResult {
    run_id: string;
    query: string;
    provider: string;
    model: string;
    answer: string;
    sources: WebSearchSource[];
    filed_sources: number;
    usage: {
        input_tokens: number;
        output_tokens: number;
        cost_usd: number;
    };
    warnings: string[];
}
export declare function runProviderWebSearch(options: WebSearchOptions): Promise<WebSearchResult>;
