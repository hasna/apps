import type { ConnectorClient } from './client';
import { encodePathSegment } from './client';
import type { ListRecordedWorkflowsParams } from '../types';

export class WorkflowsApi {
  constructor(private readonly client: ConnectorClient) {}

  async listRecordedWorkflows(params: ListRecordedWorkflowsParams = {}): Promise<unknown> {
    const path = `/api/products/${encodePathSegment(this.client.productId)}/recorded-workflows`;
    return this.client.get(path, params);
  }
}
