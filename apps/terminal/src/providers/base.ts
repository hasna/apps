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
