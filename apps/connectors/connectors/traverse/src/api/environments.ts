import type { Environment, ListResponse } from '../types';
import { TraverseClient } from './client';

export class EnvironmentsApi {
  constructor(private readonly client: TraverseClient) {}

  list(params?: Record<string, string | number | boolean | undefined>): Promise<ListResponse<Environment>> {
    return this.client.get<ListResponse<Environment>>('/environments', params);
  }

  get(environmentId: string): Promise<Environment> {
    return this.client.get<Environment>(`/environments/${encodeURIComponent(environmentId)}`);
  }

  create(body: Record<string, unknown>): Promise<Environment> {
    return this.client.post<Environment>('/environments', body);
  }
}
