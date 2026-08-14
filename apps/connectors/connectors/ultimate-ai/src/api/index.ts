import type {
  UltimateAiBot,
  UltimateAiConfig,
  UltimateAiEvent,
  UltimateAiSearchParams,
  UltimateAiSearchResult,
} from '../types';
import { UltimateAiClient } from './client';

export { UltimateAiClient, DEFAULT_BASE_URL } from './client';

export class UltimateAi {
  private readonly client: UltimateAiClient;

  constructor(config: UltimateAiConfig) {
    this.client = new UltimateAiClient(config);
  }

  static fromEnv(): UltimateAi {
    const apiKey = process.env.ULTIMATE_AI_API_KEY;
    if (!apiKey) {
      throw new Error('ULTIMATE_AI_API_KEY environment variable is required');
    }
    return new UltimateAi({
      apiKey,
      baseUrl: process.env.ULTIMATE_AI_BASE_URL,
    });
  }

  async listBots(params?: Record<string, string | number | boolean | undefined>): Promise<UltimateAiBot[] | Record<string, unknown>> {
    return this.client.request('/bots', { params });
  }

  async createBot(body: Record<string, unknown>): Promise<UltimateAiBot> {
    return this.client.request<UltimateAiBot>('/bots', { method: 'POST', body });
  }

  async getBot(botId: string): Promise<UltimateAiBot> {
    return this.client.request<UltimateAiBot>(`/bots/${encodeURIComponent(botId)}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<UltimateAiEvent[] | Record<string, unknown>> {
    return this.client.request('/events', { params });
  }

  async search(body: UltimateAiSearchParams): Promise<UltimateAiSearchResult> {
    return this.client.request<UltimateAiSearchResult>('/search', { method: 'POST', body });
  }

  async rawRequest(
    method: string,
    path: string,
    options: {
      body?: Record<string, unknown>;
      params?: Record<string, string | number | boolean | undefined>;
    } = {},
  ): Promise<unknown> {
    return this.client.request(path, { method: method.toUpperCase(), ...options });
  }

  getClient(): UltimateAiClient {
    return this.client;
  }
}
