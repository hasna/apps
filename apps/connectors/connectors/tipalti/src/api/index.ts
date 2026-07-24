import type {
  TipaltiConfig,
  Payee,
  CreatePayeeRequest,
  PayeeListResponse,
  TipaltiEvent,
  EventListResponse,
  SearchRequest,
  SearchResponse,
  RawRequestOptions,
} from '../types';
import { TipaltiClient } from './client';

export { TipaltiClient, DEFAULT_BASE_URL } from './client';

/**
 * Tipalti Connector
 * Global payments platform — payees, events, and search
 */
export class Tipalti {
  private readonly client: TipaltiClient;

  constructor(config: TipaltiConfig) {
    this.client = new TipaltiClient(config);
  }

  static fromEnv(): Tipalti {
    const apiKey = process.env.TIPALTI_API_KEY;
    const baseUrl = process.env.TIPALTI_BASE_URL;

    if (!apiKey) {
      throw new Error('TIPALTI_API_KEY environment variable is required');
    }

    return new Tipalti({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): TipaltiClient {
    return this.client;
  }

  async listPayees(params?: Record<string, string | number | boolean | undefined>): Promise<PayeeListResponse> {
    return this.client.get<PayeeListResponse>('/payees', params);
  }

  async createPayee(data: CreatePayeeRequest): Promise<Payee> {
    return this.client.post<Payee>('/payees', data);
  }

  async getPayee(payeeId: string): Promise<Payee> {
    return this.client.get<Payee>(`/payees/${encodeURIComponent(payeeId)}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<EventListResponse> {
    return this.client.get<EventListResponse>('/events', params);
  }

  async search(data: SearchRequest): Promise<SearchResponse> {
    return this.client.post<SearchResponse>('/search', data);
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request<T>(path, { method, params: query, body, headers });
  }
}

export type { TipaltiEvent };
