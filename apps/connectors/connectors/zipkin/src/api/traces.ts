import type { ListTracesParams, ZipkinSpan, ZipkinTrace } from '../types';
import type { ZipkinClient } from './client';

export class TracesApi {
  constructor(private readonly client: ZipkinClient) {}

  async list(params?: ListTracesParams): Promise<ZipkinTrace[]> {
    return this.client.get<ZipkinTrace[]>('/traces', params);
  }

  async get(traceId: string): Promise<ZipkinTrace> {
    return this.client.get<ZipkinTrace>(`/traces/${encodeURIComponent(traceId)}`);
  }

  async create(spans: ZipkinSpan | ZipkinSpan[]): Promise<unknown> {
    const body = Array.isArray(spans) ? spans : [spans];
    return this.client.post('/traces', body);
  }
}
