import type { Database } from 'bun:sqlite';
import type { KnowledgeConfig } from './workspace';
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
type ProviderFactory = (settings: {
    apiKey: string;
    baseURL?: string;
}) => unknown;
export interface AiProviderRuntimeOptions {
    config?: KnowledgeConfig;
    env?: Record<string, string | undefined>;
    factories?: Partial<Record<AiProviderId, ProviderFactory>>;
}
export declare function providerSettings(config: KnowledgeConfig | undefined, provider: AiProviderId): AiProviderSettings;
export declare function modelAliases(config?: KnowledgeConfig): Record<string, string>;
export declare function parseModelRef(modelRef: string): {
    provider: AiProviderId;
    model: string;
};
export declare function resolveModelRef(aliasOrRef: string, config?: KnowledgeConfig): string;
export declare function listModelRegistry(config?: KnowledgeConfig): ModelRegistryEntry[];
export declare function providerCredentialStatus(config: KnowledgeConfig | undefined, env?: Record<string, string | undefined>): ProviderCredentialStatus[];
export declare function providerStatus(config?: KnowledgeConfig, env?: Record<string, string | undefined>): ProviderStatusResult;
export declare function assertProviderCredentials(provider: AiProviderId, config?: KnowledgeConfig, env?: Record<string, string | undefined>): ProviderCredentialStatus;
export declare function createAiSdkProviderRegistry(options?: AiProviderRuntimeOptions): Promise<import("ai").ProviderRegistryProvider<never, ":">>;
export declare function languageModelFor(aliasOrRef: string, options?: AiProviderRuntimeOptions): Promise<import("@ai-sdk/provider").LanguageModelV3>;
export declare function normalizeAiSdkUsage(input: {
    provider: string;
    model: string;
    usage?: Record<string, unknown> | null;
    providerMetadata?: Record<string, unknown> | null;
    costUsd?: number;
}): NormalizedProviderUsage;
export declare function recordProviderUsage(db: Database, input: NormalizedProviderUsage & {
    run_id?: string | null;
    created_at?: string;
}): string;
export declare function createDeterministicFakeProvider(provider: AiProviderId): ProviderFactory;
export {};
