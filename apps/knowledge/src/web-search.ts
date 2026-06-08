import { createHash, randomUUID } from 'node:crypto';
import { migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import { ingestOpenFilesManifestItems } from './manifest-ingest';
import {
  assertProviderCredentials,
  normalizeAiSdkUsage,
  parseModelRef,
  providerSettings,
  recordProviderUsage,
  resolveModelRef,
  type AiProviderId,
} from './providers';
import { assertWebSearchAllowed, recordAuditEvent, type SafetyPolicy } from './safety';
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

function stableHash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.25));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function sourceFromRecord(value: unknown): WebSearchSource | null {
  const record = asRecord(value);
  const url = asString(record.url) ?? asString(record.uri) ?? asString(record.sourceUrl);
  if (!url) return null;
  return {
    url,
    title: asString(record.title) ?? asString(record.name),
    snippet: asString(record.snippet) ?? asString(record.text) ?? asString(record.description),
    provider_metadata: record,
  };
}

function collectSources(value: unknown, output: Map<string, WebSearchSource>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectSources(entry, output);
    return;
  }
  const source = sourceFromRecord(value);
  if (source) output.set(source.url, source);
  const record = asRecord(value);
  for (const key of ['sources', 'results', 'citations', 'annotations', 'output']) {
    if (record[key]) collectSources(record[key], output);
  }
}

function fakeSources(query: string, limit: number): WebSearchSource[] {
  return Array.from({ length: Math.min(limit, 3) }, (_, index) => ({
    url: `https://example.com/knowledge-web-${index + 1}`,
    title: `Fake web source ${index + 1}`,
    snippet: `Deterministic web-search fixture for "${query}"`,
    provider_metadata: { fake: true, rank: index + 1 },
  }));
}

async function openAiWebSearch(input: {
  query: string;
  model: string;
  config?: KnowledgeConfig;
  env: Record<string, string | undefined>;
  maxUses: number;
  domains: string[];
}) {
  const { generateText } = await import('ai');
  const { createOpenAI } = await import('@ai-sdk/openai');
  const settings = providerSettings(input.config, 'openai');
  const openai = createOpenAI({
    apiKey: input.env[settings.api_key_env],
    baseURL: settings.base_url,
  }) as any;
  const webSearch = openai.tools?.webSearch;
  if (!webSearch) throw new Error('OpenAI provider does not expose tools.webSearch.');
  return generateText({
    model: openai(input.model),
    prompt: input.query,
    tools: {
      web_search: webSearch({
        externalWebAccess: true,
        searchContextSize: 'medium',
        ...(input.domains.length > 0 ? { allowedDomains: input.domains } : {}),
      }),
    },
    toolChoice: { type: 'tool', toolName: 'web_search' },
  });
}

async function anthropicWebSearch(input: {
  query: string;
  model: string;
  config?: KnowledgeConfig;
  env: Record<string, string | undefined>;
  maxUses: number;
  domains: string[];
}) {
  const { generateText } = await import('ai');
  const { createAnthropic } = await import('@ai-sdk/anthropic');
  const settings = providerSettings(input.config, 'anthropic');
  const anthropic = createAnthropic({
    apiKey: input.env[settings.api_key_env],
    baseURL: settings.base_url,
  }) as any;
  const factory = anthropic.tools?.webSearch_20250305 ?? anthropic.tools?.webSearch;
  if (!factory) throw new Error('Anthropic provider does not expose a web search tool.');
  return generateText({
    model: anthropic(input.model),
    prompt: input.query,
    tools: {
      web_search: factory({
        maxUses: input.maxUses,
        ...(input.domains.length > 0 ? { allowedDomains: input.domains } : {}),
      }),
    },
  });
}

async function fileWebSources(options: WebSearchOptions, sources: WebSearchSource[], now: string): Promise<number> {
  if (!options.fileResults || sources.length === 0) return 0;
  const items = sources.map((source) => {
    const text = [source.title, source.snippet, source.url].filter(Boolean).join('\n');
    const hash = stableHash(text);
    return {
      source_ref: source.url,
      name: source.title ?? source.url,
      url: source.url,
      mime: 'text/plain',
      hash,
      revision: hash,
      status: 'active',
      updated_at: now,
      permissions: { mode: 'read_only', allowed_purposes: ['knowledge_answer', 'knowledge_index'] },
      metadata: {
        source_ref: source.url,
        content_source: 'provider_web_search',
        provider_metadata: source.provider_metadata,
      },
      extracted_text: text,
    };
  });
  const result = await ingestOpenFilesManifestItems({
    dbPath: options.dbPath,
    items,
    sourceLabel: `web-search:${options.query}`,
    readAction: 'provider_web_search_file_results',
    safetyPolicy: options.safetyPolicy,
    now: new Date(now),
  });
  return result.sources_upserted;
}

export async function runProviderWebSearch(options: WebSearchOptions): Promise<WebSearchResult> {
  const query = options.query.trim();
  if (!query) throw new Error('Web search query is required.');
  const env = options.env ?? process.env;
  const now = (options.now ?? new Date()).toISOString();
  const limit = Math.max(1, Math.min(options.limit ?? 5, 20));
  const maxUses = Math.max(1, Math.min(options.maxUses ?? 3, 10));
  const domains = options.domains ?? [];
  const modelRef = resolveModelRef(options.modelRef ?? (options.provider ? `${options.provider}:${providerSettings(options.config, options.provider).default_model}` : 'default'), options.config);
  const parsed = parseModelRef(modelRef);
  const provider = options.provider ?? parsed.provider;
  const model = parsed.provider === provider ? parsed.model : providerSettings(options.config, provider).default_model;
  const runId = `run_${randomUUID()}`;

  if (!options.fake && options.safetyPolicy) assertWebSearchAllowed(options.safetyPolicy);
  if (!options.fake && provider !== 'openai' && provider !== 'anthropic') {
    throw new Error(`Provider ${provider} does not expose native web search yet.`);
  }
  if (!options.fake) assertProviderCredentials(provider, options.config, env);

  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  try {
    db.run(
      `INSERT INTO runs (id, type, prompt, status, provider, model, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        'provider-web-search',
        query,
        'running',
        provider,
        model,
        JSON.stringify({ domains, max_uses: maxUses, fake: options.fake === true }),
        now,
        now,
      ],
    );
    recordAuditEvent(db, {
      event_type: 'source_read',
      action: options.fake ? 'fake_provider_web_search' : 'provider_web_search',
      target_uri: query,
      decision: 'allow',
      metadata: { provider, model, domains, max_uses: maxUses },
      created_at: now,
    });
  } finally {
    db.close();
  }

  let answer = '';
  let sources: WebSearchSource[] = [];
  let usage = { input_tokens: estimateTokens(query), output_tokens: 0, cost_usd: 0 };
  const warnings: string[] = [];
  if (options.fake) {
    sources = fakeSources(query, limit);
    answer = `Fake web search answer for: ${query}`;
    usage.output_tokens = estimateTokens(answer);
  } else {
    const result = provider === 'openai'
      ? await openAiWebSearch({ query, model, config: options.config, env, maxUses, domains })
      : await anthropicWebSearch({ query, model, config: options.config, env, maxUses, domains });
    answer = result.text;
    const collected = new Map<string, WebSearchSource>();
    collectSources((result as any).sources, collected);
    collectSources((result as any).toolResults, collected);
    sources = Array.from(collected.values()).slice(0, limit);
    const normalized = normalizeAiSdkUsage({
      provider,
      model,
      usage: (result as any).usage,
      providerMetadata: (result as any).providerMetadata,
    });
    usage = {
      input_tokens: normalized.input_tokens,
      output_tokens: normalized.output_tokens,
      cost_usd: normalized.cost_usd,
    };
  }

  const filedSources = await fileWebSources(options, sources, now);
  const writeDb = openKnowledgeDb(options.dbPath);
  try {
    writeDb.run(
      `UPDATE runs SET status = ?, metadata_json = ?, updated_at = ? WHERE id = ?`,
      [
        'completed',
        JSON.stringify({ domains, max_uses: maxUses, sources: sources.length, filed_sources: filedSources, fake: options.fake === true }),
        now,
        runId,
      ],
    );
    writeDb.run(
      `INSERT INTO run_events (id, run_id, level, event, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        `evt_${randomUUID()}`,
        runId,
        'info',
        'provider_web_search_completed',
        JSON.stringify({ sources: sources.length, filed_sources: filedSources }),
        now,
      ],
    );
    recordProviderUsage(writeDb, {
      run_id: runId,
      provider,
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cost_usd: usage.cost_usd,
      metadata: { web_search: true, sources: sources.length, filed_sources: filedSources },
      created_at: now,
    });
  } finally {
    writeDb.close();
  }

  if (sources.length === 0) warnings.push('no_web_sources_returned');
  return {
    run_id: runId,
    query,
    provider,
    model,
    answer,
    sources,
    filed_sources: filedSources,
    usage,
    warnings,
  };
}
