import type { ListFlowsOptions } from '../types';
import type { UserpilotClient } from './client';

export class FlowsApi {
  constructor(private readonly client: UserpilotClient) {}

  list(options: ListFlowsOptions = {}): Promise<unknown> {
    return this.client.get('/flows', options);
  }

  get(id: string): Promise<unknown> {
    return this.client.get(`/flows/${encodeURIComponent(id)}`);
  }
}
