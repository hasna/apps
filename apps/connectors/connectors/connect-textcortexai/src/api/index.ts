// TextCortex AI Connector
// AI writing assistant — text generation, paraphrasing, summarization

import { TextCortexClient } from './client';
import type {
  TextCortexConfig,
  GenerationOptions,
  GenerationResponse,
  UserInfo,
} from '../types';

export { TextCortexClient } from './client';

export class TextCortex {
  private readonly client: TextCortexClient;

  constructor(config: TextCortexConfig) {
    this.client = new TextCortexClient(config);
  }

  static fromEnv(): TextCortex {
    const apiKey = process.env.TEXTCORTEX_API_KEY;
    if (!apiKey) throw new Error('TEXTCORTEX_API_KEY environment variable is required');
    return new TextCortex({ apiKey });
  }

  private async generate(endpoint: string, options: GenerationOptions & { prompt?: string }): Promise<string[]> {
    const result = await this.client.request<GenerationResponse>(endpoint, {
      text: options.sourceText || options.prompt || '',
      keywords: options.keywords,
      formality: options.formality,
      max_tokens: options.maxTokens ?? 250,
      temperature: options.temperature ?? 0.7,
      n: options.n ?? 1,
    });
    return result.data.outputs.map(o => o.text);
  }

  /** Generate blog body from a title/prompt */
  async generateBlogBody(prompt: string, options?: GenerationOptions): Promise<string[]> {
    return this.generate('/texts/blog-body', { ...options, sourceText: prompt });
  }

  /** Generate blog title from a topic */
  async generateBlogTitle(topic: string, options?: GenerationOptions): Promise<string[]> {
    return this.generate('/texts/blog-title', { ...options, sourceText: topic });
  }

  /** Paraphrase text — rewrite while preserving meaning */
  async paraphrase(text: string, options?: GenerationOptions): Promise<string[]> {
    return this.generate('/texts/paraphrases', { ...options, sourceText: text });
  }

  /** Summarize text */
  async summarize(text: string, options?: GenerationOptions): Promise<string[]> {
    return this.generate('/texts/summaries', { ...options, sourceText: text });
  }

  /** Simplify text for easier reading */
  async simplify(text: string, options?: GenerationOptions): Promise<string[]> {
    return this.generate('/texts/simplifications', { ...options, sourceText: text });
  }

  /** Generate a product description */
  async generateProductDescription(productName: string, keywords?: string[], options?: GenerationOptions): Promise<string[]> {
    return this.generate('/texts/product-descriptions', { ...options, sourceText: productName, keywords });
  }

  /** Generate email content */
  async generateEmail(subject: string, options?: GenerationOptions): Promise<string[]> {
    return this.generate('/texts/emails', { ...options, sourceText: subject });
  }

  /** Extend/expand a short text */
  async extend(text: string, options?: GenerationOptions): Promise<string[]> {
    return this.generate('/texts/extensions', { ...options, sourceText: text });
  }

  /** Get user account info and word balance */
  async getUserInfo(): Promise<UserInfo> {
    return this.client.get<UserInfo>('/user/info');
  }

  getClient(): TextCortexClient {
    return this.client;
  }
}
