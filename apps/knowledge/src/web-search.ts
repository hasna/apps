import type { SafetyPolicy } from './safety';
import { KnowledgeContainmentError } from './runtime-role';
import type { KnowledgeConfig } from './workspace';

export interface WebSearchOptions {
  dbPath: string;
  query: string;
  config?: KnowledgeConfig;
  safetyPolicy?: SafetyPolicy;
  modelRef?: string;
  provider?: 'openai' | 'anthropic' | 'deepseek';
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

function containedWebSearch(): never {
  throw new KnowledgeContainmentError(
    'KNOWLEDGE_HOSTED_CONTAINED',
    503,
    'hosted-client',
    'public-api',
    'provider web search is unavailable through the Stage-A public package',
  );
}

/** Public compatibility entrypoint. It rejects before reading any option. */
export async function runProviderWebSearch(options: WebSearchOptions): Promise<WebSearchResult> {
  return containedWebSearch();
}
