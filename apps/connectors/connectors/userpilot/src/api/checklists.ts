import type { DateRangeOptions, ListFlowsOptions } from '../types';
import type { UserpilotClient } from './client';

export class ChecklistsApi {
  constructor(private readonly client: UserpilotClient) {}

  list(options: ListFlowsOptions = {}): Promise<unknown> {
    return this.client.get('/checklists', options);
  }

  get(id: string): Promise<unknown> {
    return this.client.get(`/checklists/${encodeURIComponent(id)}`);
  }

  analytics(id: string, options: DateRangeOptions = {}): Promise<unknown> {
    return this.client.get(`/checklists/${encodeURIComponent(id)}/analytics`, options);
  }
}
