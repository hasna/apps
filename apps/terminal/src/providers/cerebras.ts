// Cerebras provider — fast inference on Qwen/Llama models
import { OpenAICompatibleProvider } from "./openai-compat.js";

export class CerebrasProvider extends OpenAICompatibleProvider {
  readonly name = "cerebras";
  protected readonly baseUrl = "https://api.cerebras.ai/v1";
  protected readonly defaultModel = "qwen-3-235b-a22b-instruct-2507";
  protected readonly apiKeyEnvVar = "CEREBRAS_API_KEY";
}
