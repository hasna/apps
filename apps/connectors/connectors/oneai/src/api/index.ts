// One AI Connector — Language AI for text analysis, summarization, and extraction
import { OneAIClient } from './client';
import type { OneAIConfig, OASkill, OAPipelineResult } from '../types';
export { OneAIClient } from './client';

export class OneAI {
  private readonly client: OneAIClient;
  constructor(config: OneAIConfig) { this.client = new OneAIClient(config); }
  static fromEnv(): OneAI {
    const apiKey = process.env.ONEAI_API_KEY;
    if (!apiKey) throw new Error('ONEAI_API_KEY is required');
    return new OneAI({ apiKey });
  }

  async pipeline(text: string, steps: OASkill[]): Promise<OAPipelineResult> {
    return this.client.request<OAPipelineResult>('/pipeline', { body: { input: text, steps } as Record<string, unknown> });
  }

  async summarize(text: string): Promise<OAPipelineResult> {
    return this.pipeline(text, [{ skill: 'summarize' }]);
  }

  async extractEntities(text: string): Promise<OAPipelineResult> {
    return this.pipeline(text, [{ skill: 'names' }]);
  }

  async detectSentiment(text: string): Promise<OAPipelineResult> {
    return this.pipeline(text, [{ skill: 'sentiments' }]);
  }

  async extractKeywords(text: string): Promise<OAPipelineResult> {
    return this.pipeline(text, [{ skill: 'keywords' }]);
  }

  async detectTopics(text: string): Promise<OAPipelineResult> {
    return this.pipeline(text, [{ skill: 'article-topics' }]);
  }

  async detectLanguage(text: string): Promise<OAPipelineResult> {
    return this.pipeline(text, [{ skill: 'detect-language' }]);
  }

  async extractActionItems(text: string): Promise<OAPipelineResult> {
    return this.pipeline(text, [{ skill: 'action-items' }]);
  }

  getClient(): OneAIClient { return this.client; }
}
