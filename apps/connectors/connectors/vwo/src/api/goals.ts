import type { ConnectorClient } from './client';
import type { Goal, GoalCreateParams, ListParams } from '../types';

export class GoalsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    return this.client.get('/goals', params);
  }

  async get(id: string | number): Promise<Goal> {
    return this.client.get<Goal>(`/goals/${encodeURIComponent(String(id))}`);
  }

  async create(data: GoalCreateParams): Promise<Goal> {
    return this.client.post<Goal>('/goals', data);
  }

  async update(id: string | number, data: Record<string, unknown>): Promise<Goal> {
    return this.client.patch<Goal>(`/goals/${encodeURIComponent(String(id))}`, data);
  }

  async delete(id: string | number): Promise<unknown> {
    return this.client.delete(`/goals/${encodeURIComponent(String(id))}`);
  }
}
