export type OutputFormat = 'json' | 'pretty';

export interface WorkatoConfig {
  apiToken: string;
  baseUrl?: string;
}

export interface ProfileConfig {
  apiToken?: string;
  token?: string;
  baseUrl?: string;
}

export interface PaginatedListOptions {
  perPage?: number;
  page?: number;
}

export interface RecipeListOptions extends PaginatedListOptions {
  folderId?: number;
  running?: boolean;
  updatedAfter?: string;
  order?: string;
}

export interface JobListOptions {
  recipeId: number;
  status?: string;
  perPage?: number;
  offset?: number;
  fromTimestamp?: string;
  toTimestamp?: string;
}

export interface ConnectionListOptions extends PaginatedListOptions {
  provider?: string;
  folderId?: number;
}

export interface CreateConnectionInput {
  name: string;
  provider: string;
  folderId?: number;
  input?: Record<string, unknown>;
}

export interface UpdateConnectionInput {
  id: number;
  name?: string;
  input?: Record<string, unknown>;
}

export interface FolderListOptions extends PaginatedListOptions {
  parentId?: number;
}

export interface CreateFolderInput {
  name: string;
  parentId?: number;
}

export interface UpdateFolderInput {
  id: number;
  name?: string;
  parentId?: number;
}

export interface ExportProjectInput {
  projectId: number;
  includeData?: boolean;
}

export interface LookupRowOptions {
  tableId: number;
  column: string;
  value: string | number;
}

export interface LookupRowInput {
  tableId: number;
  data: Record<string, unknown>;
}

export interface UpdateLookupRowInput {
  tableId: number;
  rowId: number;
  data: Record<string, unknown>;
}

export interface UpsertPropertyInput {
  name: string;
  value: string;
}

export class WorkatoApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'WorkatoApiError';
    this.statusCode = statusCode;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

export function parseApiError(response: unknown, statusCode: number): WorkatoApiError {
  if (typeof response === 'string') {
    return new WorkatoApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new WorkatoApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const message =
    (data.message as string) ||
    (data.error as string) ||
    ((data.error as Record<string, unknown>)?.message as string) ||
    `HTTP ${statusCode} Error`;

  return new WorkatoApiError(message, statusCode);
}
