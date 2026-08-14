import type { ConnectorClient } from './client';
import type { CreateTriggerParams, Trigger } from '../types';

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export class TriggersApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.get('/triggers', params);
  }

  async get(triggerId: string): Promise<Trigger> {
    return this.client.get<Trigger>(`/triggers/${encodePathSegment(triggerId)}`);
  }

  async create(params: CreateTriggerParams = {}): Promise<Trigger> {
    return this.client.post<Trigger>('/triggers', params);
  }
}
