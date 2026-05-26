// TextCortex AI Connector — AI writing assistant for content generation
import { TextCortexClient } from './client';
import type { TextCortexConfig, TCGenerateResult, TCCodeResult, TCTemplate } from '../types';
export { TextCortexClient } from './client';

export class TextCortex {
  private readonly client: TextCortexClient;
  constructor(config: TextCortexConfig) { this.client = new TextCortexClient(config); }
  static fromEnv(): TextCortex {
    const apiKey = process.env.TEXTCORTEX_API_KEY;
    if (!apiKey) throw new Error('TEXTCORTEX_API_KEY is required');
    return new TextCortex({ apiKey });
  }

  async generate(text: string, options?: { mode?: string; max_tokens?: number; temperature?: number; n?: number; source_lang?: string; target_lang?: string }): Promise<TCGenerateResult> {
    return this.client.request<TCGenerateResult>('/texts/completions', { method: 'POST', body: { text, mode: options?.mode || 'default', max_tokens: options?.max_tokens, temperature: options?.temperature, n: options?.n, source_lang: options?.source_lang, target_lang: options?.target_lang } as Record<string, unknown> });
  }

  async rewrite(text: string, options?: { tone?: string; max_tokens?: number; n?: number }): Promise<TCGenerateResult> {
    return this.client.request<TCGenerateResult>('/texts/paraphrases', { method: 'POST', body: { text, tone: options?.tone, max_tokens: options?.max_tokens, n: options?.n } as Record<string, unknown> });
  }

  async summarize(text: string, options?: { max_tokens?: number; n?: number }): Promise<TCGenerateResult> {
    return this.client.request<TCGenerateResult>('/texts/summarizations', { method: 'POST', body: { text, max_tokens: options?.max_tokens, n: options?.n } as Record<string, unknown> });
  }

  async translate(text: string, targetLang: string, options?: { source_lang?: string }): Promise<TCGenerateResult> {
    return this.client.request<TCGenerateResult>('/texts/translations', { method: 'POST', body: { text, target_lang: targetLang, source_lang: options?.source_lang } as Record<string, unknown> });
  }

  async generateCode(prompt: string, options?: { language?: string; max_tokens?: number }): Promise<TCCodeResult> {
    return this.client.request<TCCodeResult>('/codes/generate', { method: 'POST', body: { prompt, language: options?.language, max_tokens: options?.max_tokens } as Record<string, unknown> });
  }

  async listTemplates(): Promise<{ data: TCTemplate[] }> { return this.client.request('/templates'); }
  async runTemplate(templateId: string, inputs: Record<string, string>): Promise<TCGenerateResult> {
    return this.client.request<TCGenerateResult>(`/templates/${templateId}/generate`, { method: 'POST', body: { inputs } as Record<string, unknown> });
  }

  getClient(): TextCortexClient { return this.client; }
}
