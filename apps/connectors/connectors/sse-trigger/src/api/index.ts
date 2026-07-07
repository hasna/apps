import type { SseTriggerConfig, JsonRecord, RawRequestOptions, Stream } from '../types';
import { SseTriggerClient } from './client';
import { StreamsApi } from './streams';
import { EventsApi } from './events';
import { SearchApi } from './search';

export class SseTrigger {
  private readonly client: SseTriggerClient;

  public readonly streams: StreamsApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: SseTriggerConfig) {
    this.client = new SseTriggerClient(config);
    this.streams = new StreamsApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  async listStreams(params?: Record<string, string | number | boolean | undefined>): Promise<Stream[] | JsonRecord> {
    return this.streams.list(params);
  }

  async createStream(body: JsonRecord): Promise<JsonRecord> {
    return this.streams.create(body);
  }

  async getStream(streamId: string): Promise<JsonRecord> {
    return this.streams.get(streamId);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<JsonRecord> {
    return this.events.list(params) as Promise<JsonRecord>;
  }

  async searchEvents(body: JsonRecord): Promise<JsonRecord> {
    return this.search.search(body);
  }

  async rawRequest(options: RawRequestOptions): Promise<JsonRecord> {
    const { path, method = 'GET', query, body, headers } = options;
    return this.client.request<JsonRecord>(path, { method, params: query, body, headers });
  }

  static fromEnv(): SseTrigger {
    const apiKey = process.env.SSE_TRIGGER_API_KEY;
    if (!apiKey) {
      throw new Error('SSE_TRIGGER_API_KEY environment variable is required');
    }
    return new SseTrigger({
      apiKey,
      baseUrl: process.env.SSE_TRIGGER_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): SseTriggerClient {
    return this.client;
  }
}

export { SseTriggerClient, DEFAULT_BASE_URL } from './client';
export { StreamsApi } from './streams';
export { EventsApi } from './events';
export { SearchApi } from './search';
