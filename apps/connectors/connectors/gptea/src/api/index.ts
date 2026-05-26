// GPTea Connector — GPT-powered AI assistant API
import { GPTeaClient } from './client';
import type { GPTeaConfig, GTCompletion, GTMessage } from '../types';
export { GPTeaClient } from './client';

export class GPTea {
  private readonly client: GPTeaClient;
  constructor(config: GPTeaConfig) { this.client = new GPTeaClient(config); }
  static fromEnv(): GPTea {
    const apiKey = process.env.GPTEA_API_KEY;
    if (!apiKey) throw new Error('GPTEA_API_KEY is required');
    return new GPTea({ apiKey });
  }

  async complete(prompt: string, options?: { model?: string; max_tokens?: number; temperature?: number }): Promise<GTCompletion> {
    return this.client.request<GTCompletion>('/completions', { body: { prompt, model: options?.model, max_tokens: options?.max_tokens, temperature: options?.temperature } as Record<string, unknown> });
  }

  async chat(messages: GTMessage[], options?: { model?: string; max_tokens?: number; temperature?: number }): Promise<GTCompletion> {
    return this.client.request<GTCompletion>('/chat/completions', { body: { messages, model: options?.model, max_tokens: options?.max_tokens, temperature: options?.temperature } as Record<string, unknown> });
  }

  async summarize(text: string): Promise<GTCompletion> {
    return this.client.request<GTCompletion>('/summarize', { body: { text } });
  }

  async translate(text: string, targetLang: string, sourceLang?: string): Promise<GTCompletion> {
    return this.client.request<GTCompletion>('/translate', { body: { text, target_language: targetLang, source_language: sourceLang } as Record<string, unknown> });
  }

  getClient(): GPTeaClient { return this.client; }
}
