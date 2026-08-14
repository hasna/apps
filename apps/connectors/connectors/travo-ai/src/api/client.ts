import {
  TravoAiApiError,
  type CreateTripRequest,
  type EventsListResponse,
  type HttpMethod,
  type RawRequestOptions,
  type SearchRequest,
  type SearchResponse,
  type Trip,
  type TravoAiConfig,
  type TripsListResponse,
} from '../types';

const DEFAULT_BASE_URL = 'https://api.travo.ai/v1';

export class TravoAiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: TravoAiConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async request<T>(
    path: string,
    options: RequestInit & { query?: Record<string, string | number | boolean | undefined> } = {}
  ): Promise<T> {
    const { query, ...fetchOptions } = options;
    const url = this.buildUrl(path, query);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...(fetchOptions.headers as Record<string, string> | undefined),
    };

    if (fetchOptions.body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      ...fetchOptions,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let message = errorText;
      try {
        const errorJson = JSON.parse(errorText) as Record<string, unknown>;
        message = String(errorJson.detail ?? errorJson.error ?? errorJson.message ?? errorText);
      } catch {
        // Use raw text
      }
      throw new TravoAiApiError(message, response.status);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  async listTrips(query?: Record<string, string | number | boolean | undefined>): Promise<TripsListResponse> {
    return this.request<TripsListResponse>('/trips', { method: 'GET', query });
  }

  async createTrip(body: CreateTripRequest): Promise<Trip> {
    return this.request<Trip>('/trips', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async getTrip(tripId: string): Promise<Trip> {
    const encodedId = encodeURIComponent(tripId);
    return this.request<Trip>(`/trips/${encodedId}`, { method: 'GET' });
  }

  async listEvents(query?: Record<string, string | number | boolean | undefined>): Promise<EventsListResponse> {
    return this.request<EventsListResponse>('/events', { method: 'GET', query });
  }

  async search(body: SearchRequest): Promise<SearchResponse> {
    return this.request<SearchResponse>('/search', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const method = (options.method ?? 'GET') as HttpMethod;
    const init: RequestInit & { query?: Record<string, string | number | boolean | undefined> } = {
      method,
      query: options.query,
      headers: options.headers,
    };

    if (options.body !== undefined && method !== 'GET' && method !== 'DELETE') {
      init.body = JSON.stringify(options.body);
    }

    return this.request<T>(options.path, init);
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
