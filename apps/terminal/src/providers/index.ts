// Provider auto-detection and management — with fallback on failure

import type { LLMProvider, ProviderConfig, ProviderOptions, StreamCallbacks } from "./base.js";
import { DEFAULT_PROVIDER_CONFIG } from "./base.js";
import { AnthropicProvider } from "./anthropic.js";
import { CerebrasProvider } from "./cerebras.js";
import { GroqProvider } from "./groq.js";
import { XaiProvider } from "./xai.js";

export type { LLMProvider, ProviderOptions, StreamCallbacks, ProviderConfig } from "./base.js";
export { DEFAULT_PROVIDER_CONFIG } from "./base.js";

let _provider: LLMProvider | null = null;
let _outputProvider: LLMProvider | null = null;
let _failedProviders: Set<string> = new Set();

/** Get the active LLM provider. Auto-detects based on available API keys. */
export function getProvider(config?: ProviderConfig): LLMProvider {
  if (_provider && !_failedProviders.has(_provider.name)) return _provider;

  const cfg = config ?? DEFAULT_PROVIDER_CONFIG;
  _provider = resolveProvider(cfg);
  return _provider;
}

/** Reset the cached provider (useful when config changes). */
export function resetProvider() {
  _provider = null;
  _outputProvider = null;
  _failedProviders.clear();
}

/**
 * Get the provider optimized for output summarization.
 * Priority: Groq (fastest, 234ms avg) > Cerebras > xAI > Anthropic.
 * Falls back to the main provider if Groq is unavailable.
 */
export function getOutputProvider(): LLMProvider {
  if (_outputProvider) return _outputProvider;

  // Prefer Groq for output processing (fastest + best compression in evals)
  const groq = new GroqProvider();
  if (groq.isAvailable()) {
    _outputProvider = groq;
    return groq;
  }

  // Fall back to main provider
  _outputProvider = getProvider();
  return _outputProvider;
}

/** Get a fallback-wrapped provider that tries alternatives on failure */
export function getProviderWithFallback(config?: ProviderConfig): LLMProvider {
  const primary = getProvider(config);
  return new FallbackProvider(primary);
}

function resolveProvider(config: ProviderConfig): LLMProvider {
  if (config.provider !== "auto") {
    const providers: Record<string, () => LLMProvider> = {
      cerebras: () => new CerebrasProvider(),
      anthropic: () => new AnthropicProvider(),
      groq: () => new GroqProvider(),
      xai: () => new XaiProvider(),
    };
    const factory = providers[config.provider];
    if (factory) {
      const p = factory();
      if (!p.isAvailable()) throw new Error(`${config.provider.toUpperCase()}_API_KEY not set`);
      return p;
    }
  }

  // auto: prefer Cerebras, then xAI, then Groq, then Anthropic — skip failed
  const candidates: LLMProvider[] = [
    new CerebrasProvider(),
    new XaiProvider(),
    new GroqProvider(),
    new AnthropicProvider(),
  ];

  for (const p of candidates) {
    if (p.isAvailable() && !_failedProviders.has(p.name)) return p;
  }

  // If all failed, clear failures and try again
  if (_failedProviders.size > 0) {
    _failedProviders.clear();
    for (const p of candidates) {
      if (p.isAvailable()) return p;
    }
  }

  throw new Error(
    "No API key found. Set one of:\n" +
    "  export CEREBRAS_API_KEY=<your-key>  (free, open-source)\n" +
    "  export GROQ_API_KEY=<your-key>      (free, fast)\n" +
    "  export XAI_API_KEY=<your-key>       (Grok, code-optimized)\n" +
    "  export ANTHROPIC_API_KEY=<your-key>  (Claude)"
  );
}

/** Provider wrapper that falls back to alternatives on API errors */
class FallbackProvider implements LLMProvider {
  readonly name: string;
  private primary: LLMProvider;

  constructor(primary: LLMProvider) {
    this.primary = primary;
    this.name = primary.name;
  }

  isAvailable(): boolean {
    return this.primary.isAvailable();
  }

  async listModels(): Promise<string[]> {
    return this.primary.listModels();
  }

  async complete(prompt: string, options: ProviderOptions): Promise<string> {
    try {
      return await this.primary.complete(prompt, options);
    } catch (err) {
      const fallback = this.getFallback();
      if (fallback) return fallback.complete(prompt, options);
      throw err;
    }
  }

  async stream(prompt: string, options: ProviderOptions, callbacks: StreamCallbacks): Promise<string> {
    try {
      return await this.primary.stream(prompt, options, callbacks);
    } catch (err) {
      const fallback = this.getFallback();
      if (fallback) return fallback.complete(prompt, options); // fallback doesn't stream
      throw err;
    }
  }

  private getFallback(): LLMProvider | null {
    _failedProviders.add(this.primary.name);
    _provider = null; // force re-resolve
    try {
      const next = getProvider();
      if (next.name !== this.primary.name) return next;
    } catch {}
    return null;
  }
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
