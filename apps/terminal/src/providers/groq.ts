// Groq provider — ultra-fast inference
import { OpenAICompatibleProvider } from "./openai-compat.js";

export class GroqProvider extends OpenAICompatibleProvider {
  readonly name = "groq";
  protected readonly baseUrl = "https://api.groq.com/openai/v1";
  protected readonly defaultModel = "openai/gpt-oss-120b";
  protected readonly apiKeyEnvVar = "GROQ_API_KEY";
}
