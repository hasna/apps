import type { ZipkinConfig, ListTracesParams, SearchParams, ZipkinSpan } from '../types';
import { ZipkinClient } from './client';
import { TracesApi } from './traces';
import { EventsApi } from './events';
import { SearchApi } from './search';

export class Zipkin {
  private readonly client: ZipkinClient;
  public readonly traces: TracesApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: ZipkinConfig) {
    this.client = new ZipkinClient(config);
    this.traces = new TracesApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): Zipkin {
    const apiKey = process.env.ZIPKIN_API_KEY;
    if (!apiKey) {
      throw new Error('ZIPKIN_API_KEY environment variable is required');
    }
    return new Zipkin({
      apiKey,
      baseUrl: process.env.ZIPKIN_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ZipkinClient {
    return this.client;
  }

  async listTraces(params?: ListTracesParams) {
    return this.traces.list(params);
  }

  async getTrace(traceId: string) {
    return this.traces.get(traceId);
  }

  async createTrace(spans: ZipkinSpan | ZipkinSpan[]) {
    return this.traces.create(spans);
  }

  async listEvents(params?: Parameters<EventsApi['list']>[0]) {
    return this.events.list(params);
  }

  async searchTraces(params: SearchParams) {
    return this.search.search(params);
  }

  async rawRequest<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    options?: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown> | unknown[] | string;
    },
  ): Promise<T> {
    return this.client.request<T>(path, {
      method,
      params: options?.params,
      body: options?.body,
    });
  }
}

export { ZipkinClient, DEFAULT_BASE_URL } from './client';
export { TracesApi } from './traces';
export { EventsApi } from './events';
export { SearchApi } from './search';
