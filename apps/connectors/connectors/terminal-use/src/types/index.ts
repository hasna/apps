// Terminal Use API Types

export interface ConnectorConfig {
  token?: string;
  apiKey?: string;
  agentApiKey?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface TextPart {
  type: 'text';
  text: string;
}

export interface DataPart {
  type: 'data';
  data: unknown;
}

export interface CreateProjectParams {
  namespace_id?: string;
  namespaceId?: string;
  name: string;
  description?: string;
}

export interface ListProjectsParams {
  namespace_id?: string;
  namespaceId?: string;
  limit?: number;
  page_number?: number;
  pageNumber?: number;
}

export interface ListAgentsParams {
  namespace_id?: string;
  namespaceId?: string;
  limit?: number;
  page_number?: number;
  pageNumber?: number;
}

export interface DeployAgentParams {
  agent_name?: string;
  agentName?: string;
  version_id?: string;
  versionId?: string;
  branch?: string;
  author_name?: string;
  authorName?: string;
  author_email?: string;
  authorEmail?: string;
  commit_message?: string;
  commitMessage?: string;
  commit_sha?: string;
  commitSha?: string;
  are_tasks_sticky?: boolean;
  areTasksSticky?: boolean;
  acp_type?: 'sync' | 'async';
  acpType?: 'sync' | 'async';
  [key: string]: unknown;
}

export interface CreateTaskParams {
  agent_id?: string;
  agentId?: string;
  agent_name?: string;
  agentName?: string;
  branch?: string;
  filesystem_id?: string;
  filesystemId?: string;
  name?: string;
  [key: string]: unknown;
}

export interface ListTasksParams {
  agent_id?: string;
  agentId?: string;
  limit?: number;
  page_number?: number;
  pageNumber?: number;
  status?: string;
}

export interface SendTaskEventParams {
  text?: string;
  data?: unknown;
  idempotency_key?: string;
  idempotencyKey?: string;
  persist_message?: boolean;
  persistMessage?: boolean;
}

export interface ListMessagesParams {
  task_id?: string;
  taskId?: string;
  limit?: number;
  page_number?: number;
  pageNumber?: number;
}

export interface CreateFilesystemParams {
  project_id?: string;
  projectId?: string;
  name?: string;
  [key: string]: unknown;
}

export interface ListFilesystemsParams {
  project_id?: string;
  projectId?: string;
  limit?: number;
  page_number?: number;
  pageNumber?: number;
}

export interface ListFilesParams {
  path?: string;
  prefix?: string;
  limit?: number;
  page_number?: number;
  pageNumber?: number;
}

export interface FilesystemUrlParams {
  path?: string;
  file_path?: string;
  filePath?: string;
  content_type?: string;
  contentType?: string;
  [key: string]: unknown;
}

export interface RawRequestParams {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: QueryParams;
  body?: unknown;
  headers?: Record<string, string>;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly detail?: unknown;

  constructor(message: string, statusCode: number, detail?: unknown) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

export function parseApiError(response: unknown, statusCode: number): ConnectorApiError {
  if (typeof response === 'string') {
    return new ConnectorApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new ConnectorApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const message =
    (data.message as string) ||
    (data.error as string) ||
    (typeof data.detail === 'string' ? data.detail : undefined) ||
    `HTTP ${statusCode} Error`;

  return new ConnectorApiError(message, statusCode, data.detail ?? data);
}

export function pickArg<T>(args: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const key of keys) {
    const value = args[key];
    if (value !== undefined && value !== null) {
      return value as T;
    }
  }
  return undefined;
}

export function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) {
      result[key as keyof T] = value as T[keyof T];
    }
  }
  return result;
}

export function normalizeQueryParams(args: Record<string, unknown>): QueryParams {
  const params: QueryParams = {};
  const namespaceId = pickArg<string>(args, 'namespace_id', 'namespaceId');
  const pageNumber = pickArg<number>(args, 'page_number', 'pageNumber');
  const agentId = pickArg<string>(args, 'agent_id', 'agentId');
  const taskId = pickArg<string>(args, 'task_id', 'taskId');
  const projectId = pickArg<string>(args, 'project_id', 'projectId');
  const limit = pickArg<number>(args, 'limit');
  const status = pickArg<string>(args, 'status');
  const path = pickArg<string>(args, 'path');
  const prefix = pickArg<string>(args, 'prefix');

  if (namespaceId !== undefined) params.namespace_id = namespaceId;
  if (pageNumber !== undefined) params.page_number = pageNumber;
  if (agentId !== undefined) params.agent_id = agentId;
  if (taskId !== undefined) params.task_id = taskId;
  if (projectId !== undefined) params.project_id = projectId;
  if (limit !== undefined) params.limit = limit;
  if (status !== undefined) params.status = status;
  if (path !== undefined) params.path = path;
  if (prefix !== undefined) params.prefix = prefix;

  return params;
}
