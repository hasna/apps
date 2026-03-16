// Provider auto-detection and management

import type { LLMProvider, ProviderConfig } from "./base.js";
import { DEFAULT_PROVIDER_CONFIG } from "./base.js";
import { AnthropicProvider } from "./anthropic.js";
import { CerebrasProvider } from "./cerebras.js";
import { GroqProvider } from "./groq.js";
import { XaiProvider } from "./xai.js";

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

  if (config.provider === "groq") {
    const p = new GroqProvider();
    if (!p.isAvailable()) throw new Error("GROQ_API_KEY not set. Run: export GROQ_API_KEY=your-key");
    return p;
  }

  if (config.provider === "xai") {
    const p = new XaiProvider();
    if (!p.isAvailable()) throw new Error("XAI_API_KEY not set. Run: export XAI_API_KEY=your-key");
    return p;
  }

  // auto: prefer Cerebras (qwen-235b, fast + accurate), then xAI, then Groq, then Anthropic
  const cerebras = new CerebrasProvider();
  if (cerebras.isAvailable()) return cerebras;

  const xai = new XaiProvider();
  if (xai.isAvailable()) return xai;

  const groq = new GroqProvider();
  if (groq.isAvailable()) return groq;

  const anthropic = new AnthropicProvider();
  if (anthropic.isAvailable()) return anthropic;

  throw new Error(
    "No API key found. Set one of:\n" +
    "  export CEREBRAS_API_KEY=your-key  (free, open-source)\n" +
    "  export GROQ_API_KEY=your-key      (free, fast)\n" +
    "  export XAI_API_KEY=your-key       (Grok, code-optimized)\n" +
    "  export ANTHROPIC_API_KEY=your-key  (Claude)"
  );
}

/** List available providers (for onboarding UI). */
export function availableProviders(): { name: string; available: boolean }[] {
  return [
    { name: "cerebras", available: new CerebrasProvider().isAvailable() },
    { name: "groq", available: new GroqProvider().isAvailable() },
    { name: "xai", available: new XaiProvider().isAvailable() },
    { name: "anthropic", available: new AnthropicProvider().isAvailable() },
  ];
}
