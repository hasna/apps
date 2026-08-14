// xAI/Grok provider — code-optimized models
import { OpenAICompatibleProvider } from "./openai-compat.js";

export class XaiProvider extends OpenAICompatibleProvider {
  readonly name = "xai";
  protected readonly baseUrl = "https://api.x.ai/v1";
  protected readonly defaultModel = "grok-code-fast-1";
  protected readonly apiKeyEnvVar = "XAI_API_KEY";
}
