import type { ComputerProvider, Provider, ProviderFallbackConfig } from "../types/index.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAIProvider } from "./openai.js";
import { chooseDefaultFallbackProvider, FallbackComputerProvider } from "./fallback.js";

export interface CreateProviderOptions {
  apiKey?: string;
  model?: string;
  fallback?: ProviderFallbackConfig | false;
  fallbackApiKey?: string;
}

/** Create a provider by name */
export function createProvider(
  provider: Provider,
  opts?: CreateProviderOptions
): ComputerProvider {
  const primary = createSingleProvider(provider, opts);
  const fallbackConfig = opts?.fallback;
  if (!fallbackConfig || fallbackConfig.enabled === false) return primary;

  const fallbackProviderName = fallbackConfig.provider ?? chooseDefaultFallbackProvider(provider);
  if (fallbackProviderName === provider) return primary;

  const fallback = createSingleProvider(fallbackProviderName, {
    apiKey: opts?.fallbackApiKey,
    model: fallbackConfig.model,
  });
  return new FallbackComputerProvider(primary, [fallback], {
    policy: fallbackConfig,
  });
}

function createSingleProvider(
  provider: Provider,
  opts?: { apiKey?: string; model?: string },
): ComputerProvider {
  switch (provider) {
    case "anthropic":
      return createAnthropicProvider(opts);
    case "openai":
      return createOpenAIProvider(opts);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

export { createAnthropicProvider } from "./anthropic.js";
export { createOpenAIProvider } from "./openai.js";
export {
  chooseDefaultFallbackProvider,
  classifyProviderError,
  DEFAULT_PROVIDER_FALLBACK_ON,
  FallbackComputerProvider,
} from "./fallback.js";
export type { FallbackComputerProviderOptions } from "./fallback.js";
