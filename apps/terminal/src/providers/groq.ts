// Groq provider — ultra-fast inference
import { OpenAICompatibleProvider } from "./openai-compat.js";

export class GroqProvider extends OpenAICompatibleProvider {
  readonly name = "groq";
  protected readonly baseUrl = "https://api.groq.com/openai/v1";
  protected readonly defaultModel = "openai/gpt-oss-120b";
  protected readonly apiKeyEnvVar = "GROQ_API_KEY";
  // Preference order resolved against the key's own model list (GET /models).
  // llama-3.1-8b-instant is the historic output-summarization workhorse;
  // moonshotai/kimi-k2-instruct is NOT first because many keys 404 on it
  // with model_not_found (O15-04797).
  protected readonly preferredModels = [
    "llama-3.1-8b-instant",
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
    "qwen/qwen3.6-27b",
    "qwen/qwen3.8-27b",
    "moonshotai/kimi-k2-instruct",
  ];
}
