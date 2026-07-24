import type { KnowledgeDatabase as Database } from './knowledge-db';
import type { KnowledgeConfig } from './workspace';
import { KnowledgeContainmentError } from './runtime-role';

export type AiProviderId = 'openai' | 'anthropic' | 'deepseek';

export interface AiProviderSettings {
  api_key_env: string;
  base_url?: string;
  default_model: string;
}

export interface AiProvidersConfig {
  default_model?: string;
  aliases?: Record<string, string>;
  openai?: Partial<AiProviderSettings>;
  anthropic?: Partial<AiProviderSettings>;
  deepseek?: Partial<AiProviderSettings>;
}

export interface ModelCapabilities {
  text_generation: boolean;
  structured_output: boolean;
  tool_usage: boolean;
  tool_streaming: boolean;
  image_input: boolean;
  native_web_search: boolean;
  reasoning: boolean;
  embeddings: boolean;
}

export interface ModelRegistryEntry {
  alias: string;
  model_ref: string;
  provider: AiProviderId;
  model: string;
  default: boolean;
  capabilities: ModelCapabilities;
}

export interface ProviderCredentialStatus {
  provider: AiProviderId;
  api_key_env: string;
  configured: boolean;
  source: 'env' | 'missing';
  base_url: string | null;
  default_model: string;
}

export interface ProviderStatusResult {
  default_model: string;
  providers: ProviderCredentialStatus[];
  models: ModelRegistryEntry[];
}

export interface NormalizedProviderUsage {
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  metadata: Record<string, unknown>;
}

type ProviderFactory = (settings: { apiKey: string; baseURL?: string }) => unknown;

export interface AiProviderRuntimeOptions {
  config?: KnowledgeConfig;
  env?: Record<string, string | undefined>;
  factories?: Partial<Record<AiProviderId, ProviderFactory>>;
}

const DEFAULT_PROVIDER_SETTINGS: Record<AiProviderId, AiProviderSettings> = {
  openai: {
    api_key_env: 'OPENAI_API_KEY',
    default_model: 'gpt-5.2',
  },
  anthropic: {
    api_key_env: 'ANTHROPIC_API_KEY',
    default_model: 'claude-sonnet-4-6',
  },
  deepseek: {
    api_key_env: 'DEEPSEEK_API_KEY',
    default_model: 'deepseek-chat',
  },
};

const PROVIDER_CAPABILITIES: Record<AiProviderId, ModelCapabilities> = {
  openai: {
    text_generation: true,
    structured_output: true,
    tool_usage: true,
    tool_streaming: true,
    image_input: true,
    native_web_search: true,
    reasoning: true,
    embeddings: true,
  },
  anthropic: {
    text_generation: true,
    structured_output: true,
    tool_usage: true,
    tool_streaming: true,
    image_input: true,
    native_web_search: false,
    reasoning: true,
    embeddings: false,
  },
  deepseek: {
    text_generation: true,
    structured_output: true,
    tool_usage: true,
    tool_streaming: true,
    image_input: false,
    native_web_search: false,
    reasoning: true,
    embeddings: false,
  },
};

const BUILTIN_ALIASES: Record<string, string> = {
  default: 'openai:gpt-5.2',
  fast: 'openai:gpt-5-mini',
  reasoning: 'anthropic:claude-opus-4-6',
  sonnet: 'anthropic:claude-sonnet-4-6',
  deepseek: 'deepseek:deepseek-chat',
  'deepseek-reasoning': 'deepseek:deepseek-reasoner',
};

function providerConfig(config?: KnowledgeConfig): AiProvidersConfig {
  return (config as KnowledgeConfig & { providers?: AiProvidersConfig } | undefined)?.providers ?? {};
}

export function providerSettings(config: KnowledgeConfig | undefined, provider: AiProviderId): AiProviderSettings {
  const configured = providerConfig(config)[provider] ?? {};
  return {
    ...DEFAULT_PROVIDER_SETTINGS[provider],
    ...configured,
  };
}

export function modelAliases(config?: KnowledgeConfig): Record<string, string> {
  const configured = providerConfig(config);
  return {
    ...BUILTIN_ALIASES,
    ...(configured.default_model ? { default: configured.default_model } : {}),
    ...(configured.aliases ?? {}),
  };
}

export function parseModelRef(modelRef: string): { provider: AiProviderId; model: string } {
  const [provider, ...rest] = modelRef.split(':');
  const model = rest.join(':');
  if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'deepseek') {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
  if (!model) throw new Error(`Invalid model ref: ${modelRef}. Expected provider:model.`);
  return { provider, model };
}

export function resolveModelRef(aliasOrRef: string, config?: KnowledgeConfig): string {
  const aliases = modelAliases(config);
  return aliases[aliasOrRef] ?? aliasOrRef;
}

export function listModelRegistry(config?: KnowledgeConfig): ModelRegistryEntry[] {
  const aliases = modelAliases(config);
  return Object.entries(aliases).map(([alias, modelRef]) => {
    const parsed = parseModelRef(modelRef);
    return {
      alias,
      model_ref: modelRef,
      provider: parsed.provider,
      model: parsed.model,
      default: alias === 'default',
      capabilities: PROVIDER_CAPABILITIES[parsed.provider],
    };
  });
}

export function providerCredentialStatus(config: KnowledgeConfig | undefined, env: Record<string, string | undefined> = process.env): ProviderCredentialStatus[] {
  return (Object.keys(DEFAULT_PROVIDER_SETTINGS) as AiProviderId[]).map((provider) => {
    const settings = providerSettings(config, provider);
    const configured = Boolean(env[settings.api_key_env]);
    return {
      provider,
      api_key_env: settings.api_key_env,
      configured,
      source: configured ? 'env' : 'missing',
      base_url: settings.base_url ?? null,
      default_model: settings.default_model,
    };
  });
}

export function providerStatus(config?: KnowledgeConfig, env: Record<string, string | undefined> = process.env): ProviderStatusResult {
  return {
    default_model: resolveModelRef('default', config),
    providers: providerCredentialStatus(config, env),
    models: listModelRegistry(config),
  };
}

export function assertProviderCredentials(
  provider: AiProviderId,
  config?: KnowledgeConfig,
  env?: Record<string, string | undefined>,
): ProviderCredentialStatus;
export function assertProviderCredentials(provider: AiProviderId): ProviderCredentialStatus {
  return containedProvider();
}

function containedProvider(): never {
  throw new KnowledgeContainmentError(
    'KNOWLEDGE_HOSTED_CONTAINED', 503, 'hosted-client', 'public-api',
    'provider construction is unavailable during Stage A',
  );
}

export function createAiSdkProviderRegistry(
  options?: AiProviderRuntimeOptions,
): Promise<import('ai').ProviderRegistryProvider<never, ':'>>;
export async function createAiSdkProviderRegistry(): Promise<import('ai').ProviderRegistryProvider<never, ':'>> {
  return containedProvider();
}

export function languageModelFor(
  aliasOrRef: string,
  options?: AiProviderRuntimeOptions,
): Promise<import('@ai-sdk/provider').LanguageModelV3>;
export async function languageModelFor(
  aliasOrRef: string,
): Promise<import('@ai-sdk/provider').LanguageModelV3> {
  return containedProvider();
}

function usageNumber(usage: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

export function normalizeAiSdkUsage(input: {
  provider: string;
  model: string;
  usage?: Record<string, unknown> | null;
  providerMetadata?: Record<string, unknown> | null;
  costUsd?: number;
}): NormalizedProviderUsage {
  const usage = input.usage ?? {};
  return {
    provider: input.provider,
    model: input.model,
    input_tokens: usageNumber(usage, ['inputTokens', 'promptTokens', 'input_tokens', 'prompt_tokens']),
    output_tokens: usageNumber(usage, ['outputTokens', 'completionTokens', 'output_tokens', 'completion_tokens']),
    cost_usd: input.costUsd ?? 0,
    metadata: {
      usage,
      provider_metadata: input.providerMetadata ?? {},
    },
  };
}

export function recordProviderUsage(
  db: Database,
  input: NormalizedProviderUsage & { run_id?: string | null; created_at?: string },
): string {
  return containedProvider();
}

export function createDeterministicFakeProvider(provider: AiProviderId): ProviderFactory {
  return containedProvider();
}
