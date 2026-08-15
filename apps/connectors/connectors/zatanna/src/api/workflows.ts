import type {
  DiscoverWorkflowsOptions,
  ExportWorkflowOptions,
  HttpMethod,
  InvokeHostedEndpointOptions,
  InvokeWorkflowOptions,
  ListRunEventsOptions,
  RawRequestOptions,
  ReplayCaptureOptions,
  SearchWorkflowsOptions,
} from '../types';
import { ZatannaClient } from './client';

function workflowId(options: { workflowId?: string; workflow_id?: string }): string {
  const id = options.workflowId ?? options.workflow_id;
  if (!id?.trim()) {
    throw new Error('workflow_id is required');
  }
  return id.trim();
}

function runId(options: { runId?: string; run_id?: string }): string {
  const id = options.runId ?? options.run_id;
  if (!id?.trim()) {
    throw new Error('run_id is required');
  }
  return id.trim();
}

function captureId(options: { captureId?: string; capture_id?: string }): string {
  const id = options.captureId ?? options.capture_id;
  if (!id?.trim()) {
    throw new Error('capture_id is required');
  }
  return id.trim();
}

function workspaceId(
  client: ZatannaClient,
  options: { workspaceId?: string; workspace_id?: string },
): string | undefined {
  return (options.workspaceId ?? options.workspace_id)?.trim() || client.defaultWorkspaceId;
}

function parseMethod(method?: string): HttpMethod {
  const resolved = (method ?? 'POST').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(resolved)) {
    throw new Error('method must be GET, POST, PUT, PATCH, or DELETE');
  }
  return resolved as HttpMethod;
}

export class WorkflowsApi {
  constructor(private readonly client: ZatannaClient) {}

  async searchWorkflows(options: SearchWorkflowsOptions = {}): Promise<unknown> {
    const query = options.query ?? options.q;
    return this.client.get('/workflows', {
      query,
      status: options.status,
      cursor: options.cursor,
      workspace_id: workspaceId(this.client, options),
      limit: options.limit,
    });
  }

  async discoverWorkflows(options: DiscoverWorkflowsOptions): Promise<unknown> {
    const query = options.query ?? options.q;
    if (!query?.trim()) {
      throw new Error('query is required');
    }
    return this.client.get('/workflows/discover', {
      query: query.trim(),
      target: options.target,
      workspace_id: workspaceId(this.client, options),
      limit: options.limit,
    });
  }

  async getWorkflow(workflowIdValue: string): Promise<unknown> {
    return this.client.get(`/workflows/${encodeURIComponent(workflowIdValue)}`);
  }

  async invokeWorkflow(options: InvokeWorkflowOptions): Promise<unknown> {
    const id = workflowId(options);
    return this.client.post(`/workflows/${encodeURIComponent(id)}/invoke`, {
      input: options.input ?? {},
      metadata: options.metadata,
      idempotency_key: options.idempotencyKey ?? options.idempotency_key,
      dry_run: options.dryRun ?? options.dry_run,
    });
  }

  async invokeHostedEndpoint(options: InvokeHostedEndpointOptions): Promise<unknown> {
    const method = parseMethod(options.method);
    const path = ZatannaClient.relativePath(options.path);
    return this.client.request(path, {
      method,
      params: options.query,
      body: method === 'GET' ? undefined : ((options.body ?? {}) as Record<string, unknown>),
      headers: options.headers,
    });
  }

  async getRunStatus(runIdValue: string): Promise<unknown> {
    return this.client.get(`/runs/${encodeURIComponent(runIdValue)}`);
  }

  async listRunEvents(options: ListRunEventsOptions): Promise<unknown> {
    const id = runId(options);
    return this.client.get(`/runs/${encodeURIComponent(id)}/events`, {
      cursor: options.cursor,
      limit: options.limit,
    });
  }

  async exportWorkflow(options: ExportWorkflowOptions): Promise<unknown> {
    const id = workflowId(options);
    return this.client.get(`/workflows/${encodeURIComponent(id)}/export`, {
      format: options.format ?? 'openapi',
      include_secrets: options.includeSecrets ?? options.include_secrets ?? false,
    });
  }

  async replayCapture(options: ReplayCaptureOptions): Promise<unknown> {
    const id = captureId(options);
    return this.client.post(`/captures/${encodeURIComponent(id)}/replay`, {
      input: options.input ?? {},
      metadata: options.metadata,
    });
  }

  async rawRequest(options: RawRequestOptions): Promise<unknown> {
    const method = parseMethod(options.method ?? 'GET');
    const path = ZatannaClient.relativePath(options.path ?? '/');
    return this.client.request(path, {
      method,
      params: options.query,
      body: method === 'GET' ? undefined : ((options.body ?? {}) as Record<string, unknown>),
      headers: options.headers,
    });
  }
}
