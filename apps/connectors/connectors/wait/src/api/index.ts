import type {
  WaitConfig,
  Delay,
  WaitEvent,
  SearchRequest,
  SearchResult,
  RawRequestOptions,
} from '../types';
import { WaitClient } from './client';

/**
 * Wait Connector
 * Delay workflow platform API (https://api.wait.com/v1)
 */
export class Wait {
  private readonly client: WaitClient;

  constructor(config: WaitConfig) {
    this.client = new WaitClient(config);
  }

  static fromEnv(): Wait {
    const apiKey = process.env.WAIT_API_KEY;
    const baseUrl = process.env.WAIT_BASE_URL;

    if (!apiKey) {
      throw new Error('WAIT_API_KEY environment variable is required');
    }

    return new Wait({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): WaitClient {
    return this.client;
  }

  async listDelays(params?: Record<string, string | number | boolean | undefined>): Promise<Delay[] | Delay> {
    return this.client.get<Delay[] | Delay>('/delays', params);
  }

  async createDelay(body: Record<string, unknown>): Promise<Delay> {
    return this.client.post<Delay>('/delays', body);
  }

  async getDelay(delayId: string): Promise<Delay> {
    const encoded = encodeURIComponent(delayId);
    return this.client.get<Delay>(`/delays/${encoded}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<WaitEvent[] | WaitEvent> {
    return this.client.get<WaitEvent[] | WaitEvent>('/events', params);
  }

  async search(body: SearchRequest): Promise<SearchResult> {
    return this.client.post<SearchResult>('/search', body);
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, params, body, headers } = options;
    return this.client.request<T>(path, { method, params, body, headers });
  }
}

export { WaitClient, DEFAULT_BASE_URL } from './client';
