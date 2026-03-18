// Syncly Connector — Customer feedback intelligence platform
import { SynclyClient } from './client';
import type { SynclyConfig, SYFeedback, SYFeedbackList, SYInsight, SYCategory, SYIntegration } from '../types';
export { SynclyClient } from './client';

export class Syncly {
  private readonly client: SynclyClient;
  constructor(config: SynclyConfig) { this.client = new SynclyClient(config); }
  static fromEnv(): Syncly {
    const apiKey = process.env.SYNCLY_API_KEY;
    if (!apiKey) throw new Error('SYNCLY_API_KEY is required');
    return new Syncly({ apiKey });
  }

  async listFeedback(options?: { page?: number; per_page?: number; sentiment?: string; category?: string; source?: string }): Promise<SYFeedbackList> {
    return this.client.request<SYFeedbackList>('/feedback', { params: { page: options?.page, per_page: options?.per_page, sentiment: options?.sentiment, category: options?.category, source: options?.source } });
  }
  async getFeedback(feedbackId: string): Promise<SYFeedback> { return this.client.request<SYFeedback>(`/feedback/${feedbackId}`); }

  async listInsights(): Promise<SYInsight[]> { return this.client.request<SYInsight[]>('/insights'); }
  async getInsight(insightId: string): Promise<SYInsight> { return this.client.request<SYInsight>(`/insights/${insightId}`); }

  async listCategories(): Promise<SYCategory[]> { return this.client.request<SYCategory[]>('/categories'); }

  async listIntegrations(): Promise<SYIntegration[]> { return this.client.request<SYIntegration[]>('/integrations'); }

  getClient(): SynclyClient { return this.client; }
}
