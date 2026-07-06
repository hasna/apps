import type { ConnectorClient } from './client';
import type { AgentListResponse, AgentResponse, ListParams } from '../types';

export class AgentsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<AgentListResponse> {
    return this.client.get<AgentListResponse>('/agents', params as Record<string, string | number>);
  }

  async get(id: string): Promise<AgentResponse> {
    return this.client.get<AgentResponse>(`/agents/${encodeURIComponent(id)}`);
  }

  async create(body: Record<string, unknown>): Promise<AgentResponse> {
    return this.client.post<AgentResponse>('/agents', body);
  }
}
