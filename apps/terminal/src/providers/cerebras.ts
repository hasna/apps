// Cerebras provider — fast inference on Qwen/Llama models
import { OpenAICompatibleProvider } from "./openai-compat.js";

export class CerebrasProvider extends OpenAICompatibleProvider {
  readonly name = "cerebras";
  protected readonly baseUrl = "https://api.cerebras.ai/v1";
  protected readonly defaultModel = "qwen-3-235b-a22b-instruct-2507";
  protected readonly apiKeyEnvVar = "CEREBRAS_API_KEY";
  // Preference order resolved against the key's own model list (GET /models).
  // qwen-3-235b is NOT first: many keys only have access to gpt-oss-120b and
  // gemma-4-31b, and calling qwen-3-235b 404s with model_not_found (O15-04797).
  protected readonly preferredModels = [
    "gpt-oss-120b",
    "gemma-4-31b",
    "qwen-3-235b-a22b-instruct-2507",
  ];
}
