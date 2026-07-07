import type { SseTriggerClient } from './client';
import type { JsonRecord, Stream } from '../types';

export class StreamsApi {
  constructor(private readonly client: SseTriggerClient) {}

  async list(params?: Record<string, string | number | boolean | undefined>): Promise<Stream[] | JsonRecord> {
    return this.client.get<Stream[] | JsonRecord>('/streams', params);
  }

  async create(body: JsonRecord): Promise<Stream | JsonRecord> {
    return this.client.post<Stream | JsonRecord>('/streams', body);
  }

  async get(streamId: string): Promise<Stream | JsonRecord> {
    return this.client.get<Stream | JsonRecord>(`/streams/${encodeURIComponent(streamId)}`);
  }
}
