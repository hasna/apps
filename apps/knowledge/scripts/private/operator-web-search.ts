import { KnowledgeContainmentError } from '../../src/runtime-role.js';
import type { AiProviderId } from '../../src/providers.js';
import type { SafetyPolicy } from '../../src/safety.js';
import type { KnowledgeConfig } from '../../src/workspace.js';

declare const OPERATOR_WEB_SEARCH_CAPABILITY: unique symbol;

/** Inert type-level compatibility only; no Stage-A runtime can mint it. */
export interface OperatorWebSearchCapability {
  readonly [OPERATOR_WEB_SEARCH_CAPABILITY]: true;
}

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

function containedOperatorWebSearch(): never {
  throw new KnowledgeContainmentError(
    'KNOWLEDGE_HOSTED_CONTAINED',
    503,
    'hosted-client',
    'operator-migration',
    'operator web search is unavailable during Stage A',
  );
}

/** Retained name, but Stage A cannot create an operational capability. */
export function createOperatorWebSearchCapability(): OperatorWebSearchCapability {
  return containedOperatorWebSearch();
}

/** Reject before reading capability, options, environment, provider, or database state. */
export async function runOperatorWebSearch(
  capability: OperatorWebSearchCapability,
  options: WebSearchOptions,
): Promise<WebSearchResult> {
  return containedOperatorWebSearch();
}
