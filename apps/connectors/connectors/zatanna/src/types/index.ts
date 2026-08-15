// Zatanna AI Connector Types

export interface ZatannaConfig {
  apiKey: string;
  baseUrl?: string;
  authHeader?: string;
  defaultWorkspaceId?: string;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface SearchWorkflowsOptions {
  query?: string;
  q?: string;
  status?: string;
  cursor?: string;
  workspaceId?: string;
  workspace_id?: string;
  limit?: number;
}

export interface DiscoverWorkflowsOptions {
  query: string;
  q?: string;
  target?: string;
  workspaceId?: string;
  workspace_id?: string;
  limit?: number;
}

export interface InvokeWorkflowOptions {
  workflowId: string;
  workflow_id?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  idempotency_key?: string;
  dryRun?: boolean;
  dry_run?: boolean;
}

export interface InvokeHostedEndpointOptions {
  path: string;
  method?: HttpMethod | string;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ExportWorkflowOptions {
  workflowId: string;
  workflow_id?: string;
  format?: string;
  includeSecrets?: boolean;
  include_secrets?: boolean;
}

export interface ReplayCaptureOptions {
  captureId: string;
  capture_id?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface RawRequestOptions {
  path: string;
  method?: HttpMethod | string;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ListRunEventsOptions {
  runId: string;
  run_id?: string;
  cursor?: string;
  limit?: number;
}

export class ZatannaApiError extends Error {
  public readonly statusCode: number;
  public readonly path: string;

  constructor(message: string, statusCode: number, path: string) {
    super(message);
    this.name = 'ZatannaApiError';
    this.statusCode = statusCode;
    this.path = path;
  }
}
