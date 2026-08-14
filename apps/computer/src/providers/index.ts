import type { ComputerProvider, Provider } from "../types/index.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAIProvider } from "./openai.js";

/** Create a provider by name */
export function createProvider(
  provider: Provider,
  opts?: { apiKey?: string; model?: string }
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
