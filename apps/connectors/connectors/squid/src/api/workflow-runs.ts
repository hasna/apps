import type { CreateWorkflowRunParams, WorkflowRun } from '../types';
import type { ConnectorClient } from './client';

export class WorkflowRunsApi {
  constructor(private readonly client: ConnectorClient) {}

  create(params: CreateWorkflowRunParams): Promise<WorkflowRun> {
    return this.client.post('/workflow-runs', params);
  }
}
