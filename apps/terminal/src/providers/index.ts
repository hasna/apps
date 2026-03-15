// Provider auto-detection and management

import type { LLMProvider, ProviderConfig } from "./base.js";
import { DEFAULT_PROVIDER_CONFIG } from "./base.js";
import { AnthropicProvider } from "./anthropic.js";
import { CerebrasProvider } from "./cerebras.js";

export type { LLMProvider, ProviderOptions, StreamCallbacks, ProviderConfig } from "./base.js";
export { DEFAULT_PROVIDER_CONFIG } from "./base.js";

let _provider: LLMProvider | null = null;

/** Get the active LLM provider. Auto-detects based on available API keys. */
export function getProvider(config?: ProviderConfig): LLMProvider {
  if (_provider) return _provider;

  const cfg = config ?? DEFAULT_PROVIDER_CONFIG;
  _provider = resolveProvider(cfg);
  return _provider;
}

/** Reset the cached provider (useful when config changes). */
export function resetProvider() {
  _provider = null;
}

function resolveProvider(config: ProviderConfig): LLMProvider {
  if (config.provider === "cerebras") {
    const p = new CerebrasProvider();
    if (!p.isAvailable()) throw new Error("CEREBRAS_API_KEY not set. Run: export CEREBRAS_API_KEY=your-key");
    return p;
  }

  if (config.provider === "anthropic") {
    const p = new AnthropicProvider();
    if (!p.isAvailable()) throw new Error("ANTHROPIC_API_KEY not set. Run: export ANTHROPIC_API_KEY=your-key");
    return p;
  }

  // auto: prefer Cerebras (open-source friendly), fall back to Anthropic
  const cerebras = new CerebrasProvider();
  if (cerebras.isAvailable()) return cerebras;

  const anthropic = new AnthropicProvider();
  if (anthropic.isAvailable()) return anthropic;

  throw new Error(
    "No API key found. Set one of:\n" +
    "  export CEREBRAS_API_KEY=your-key  (free, open-source)\n" +
    "  export ANTHROPIC_API_KEY=your-key (Claude)"
  );
}

/** List available providers (for onboarding UI). */
export function availableProviders(): { name: string; available: boolean }[] {
  return [
    { name: "cerebras", available: new CerebrasProvider().isAvailable() },
    { name: "anthropic", available: new AnthropicProvider().isAvailable() },
  ];
}
