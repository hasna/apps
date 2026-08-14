import type { UnissonClient } from './client';
import { encodePathSegment } from './client';
import type { ListResponse, UnissonAgent } from '../types';

export class AgentsApi {
  constructor(private readonly client: UnissonClient) {}

  list(params?: Record<string, string | number | boolean | undefined>): Promise<ListResponse<UnissonAgent>> {
    return this.client.get<ListResponse<UnissonAgent>>('/agents', params);
  }

  get(agentId: string): Promise<UnissonAgent> {
    return this.client.get<UnissonAgent>(`/agents/${encodePathSegment(agentId)}`);
  }

  create(body: Record<string, unknown>): Promise<UnissonAgent> {
    return this.client.post<UnissonAgent>('/agents', body);
  }
}
