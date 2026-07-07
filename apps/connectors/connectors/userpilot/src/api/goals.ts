import type { CreateGoalOptions, PaginationOptions } from '../types';
import type { UserpilotClient } from './client';

export class GoalsApi {
  constructor(private readonly client: UserpilotClient) {}

  list(options: PaginationOptions = {}): Promise<unknown> {
    return this.client.get('/goals', options);
  }

  get(id: string): Promise<unknown> {
    return this.client.get(`/goals/${encodeURIComponent(id)}`);
  }

  create(options: CreateGoalOptions): Promise<unknown> {
    return this.client.post('/goals', options);
  }

  delete(id: string): Promise<unknown> {
    return this.client.delete(`/goals/${encodeURIComponent(id)}`);
  }
}
