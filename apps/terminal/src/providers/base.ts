// Provider interface for LLM backends (Anthropic, Cerebras, etc.)

export interface ProviderOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
  system: string;
}

export interface StreamCallbacks {
  onToken: (partial: string) => void;
}

export interface LLMProvider {
  readonly name: string;

  /** Generate a completion (non-streaming) */
  complete(prompt: string, options: ProviderOptions): Promise<string>;

  /** Generate a completion with streaming */
  stream(prompt: string, options: ProviderOptions, callbacks: StreamCallbacks): Promise<string>;

  /** Check if the provider is available (has API key, etc.) */
  isAvailable(): boolean;

  /**
   * Model ids the configured key can access, per the provider's own model
   * list. Returns [] when the list cannot be discovered (offline, or a
   * provider without a model-list endpoint) — callers must then fall back to
   * their static defaults.
   */
  listModels(): Promise<string[]>;
}

export interface ProviderConfig {
  provider: "cerebras" | "anthropic" | "groq" | "xai" | "auto";
  cerebrasModel?: string;
  anthropicModel?: string;
  groqModel?: string;
  xaiModel?: string;
}

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  provider: "auto",
};

/**
 * Pick the first preferred model the configured key can actually access.
 * When the accessible list is unknown/empty, or no preferred model is in it,
 * fall back to the static default rather than inventing a model.
 */
export function selectAccessibleModel(
  preferred: string[],
  accessible: string[],
  fallback: string,
): string {
  if (accessible.length === 0) return fallback;
  for (const model of preferred) {
    if (accessible.includes(model)) return model;
  }
  return fallback;
}
