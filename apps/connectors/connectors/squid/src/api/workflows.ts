import type { ListParams, Workflow } from '../types';
import type { ConnectorClient } from './client';

export class WorkflowsApi {
  constructor(private readonly client: ConnectorClient) {}

  list(params?: ListParams): Promise<Workflow[] | { data: Workflow[] }> {
    return this.client.get('/workflows', params);
  }
}
