// Tisane Labs Connector — NLP for content moderation, sentiment, and language understanding
import { TisaneLabsClient } from './client';
import type { TisaneLabsConfig, TLParseResult, TLLanguageDetection, TLTransformResult } from '../types';
export { TisaneLabsClient } from './client';

export class TisaneLabs {
  private readonly client: TisaneLabsClient;
  constructor(config: TisaneLabsConfig) { this.client = new TisaneLabsClient(config); }
  static fromEnv(): TisaneLabs {
    const apiKey = process.env.TISANELABS_API_KEY;
    if (!apiKey) throw new Error('TISANELABS_API_KEY is required');
    return new TisaneLabs({ apiKey });
  }

  async parse(text: string, language: string, options?: { abuse_detection?: boolean; sentiment_analysis?: boolean; entity_extraction?: boolean; topic_extraction?: boolean }): Promise<TLParseResult> {
    return this.client.request<TLParseResult>('/parse', { content: text, language, settings: { abuse: options?.abuse_detection !== false, sentiment: options?.sentiment_analysis !== false, entities: options?.entity_extraction !== false, topics: options?.topic_extraction !== false } });
  }

  async detectAbuse(text: string, language: string): Promise<TLParseResult> {
    return this.client.request<TLParseResult>('/parse', { content: text, language, settings: { abuse: true, sentiment: false, entities: false, topics: false } });
  }

  async analyzeSentiment(text: string, language: string): Promise<TLParseResult> {
    return this.client.request<TLParseResult>('/parse', { content: text, language, settings: { abuse: false, sentiment: true, entities: false, topics: false } });
  }

  async detectLanguage(text: string): Promise<TLLanguageDetection[]> {
    return this.client.request<TLLanguageDetection[]>('/detectLanguage', { content: text });
  }

  async transform(text: string, language: string, operation: string): Promise<TLTransformResult> {
    return this.client.request<TLTransformResult>('/transform', { content: text, language, operation });
  }

  getClient(): TisaneLabsClient { return this.client; }
}
