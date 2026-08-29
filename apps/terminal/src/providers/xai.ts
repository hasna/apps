// xAI/Grok provider — code-optimized models
import { OpenAICompatibleProvider } from "./openai-compat.js";

export class XaiProvider extends OpenAICompatibleProvider {
  readonly name = "xai";
  protected readonly baseUrl = "https://api.x.ai/v1";
  protected readonly defaultModel = "grok-code-fast-1";
  protected readonly apiKeyEnvVar = "XAI_API_KEY";
  // xAI's grok fast/reasoning models reject the OpenAI `stop` parameter with
  // 400 ("does not support parameter stop"), so never send it (O15-04797).
  protected readonly supportsStop = false;
  // Preference order resolved against the key's own model list (GET /models).
  // grok-4.20-0309-non-reasoning is the newest non-reasoning model and the
  // only one verified to accept the stop parameter; grok-code-fast-1 and
  // grok-4-fast-non-reasoning reject it with 400 (O15-04797).
  protected readonly preferredModels = [
    "grok-4.20-0309-non-reasoning",
    "grok-4.6",
    "grok-4.5",
    "grok-4.3",
    "grok-code-fast-1",
    "grok-4-fast-non-reasoning",
  ];
}
