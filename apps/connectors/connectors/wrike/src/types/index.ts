// Wrike Connector Types

export interface WrikeConfig {
  apiToken: string;
  host?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface WrikeApiResponse<T = unknown> {
  kind: string;
  data: T;
}

export interface WrikeErrorBody {
  errorDescription?: string;
  error?: string;
  message?: string;
}

export class WrikeApiError extends Error {
  readonly statusCode: number;
  readonly body?: WrikeErrorBody;

  constructor(message: string, statusCode: number, body?: WrikeErrorBody) {
    super(message);
    this.name = 'WrikeApiError';
    this.statusCode = statusCode;
    this.body = body;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }
}

export function parseWrikeError(data: unknown, statusCode: number): WrikeApiError {
  if (data && typeof data === 'object') {
    const record = data as WrikeErrorBody;
    const message =
      record.errorDescription ??
      record.error ??
      record.message ??
      `Wrike API request failed (${statusCode})`;
    return new WrikeApiError(message, statusCode, record);
  }
  return new WrikeApiError(`Wrike API request failed (${statusCode})`, statusCode);
}

// Task types
export interface ListTasksOptions {
  folderId?: string;
  status?: string;
  importance?: string;
  createdDate?: string;
  updatedDate?: string;
  descendants?: boolean;
  subTasks?: boolean;
  pageSize?: number;
  nextPageToken?: string;
  fields?: string[];
}

export interface CreateTaskInput {
  folderId: string;
  title: string;
  description?: string;
  status?: string;
  importance?: string;
  dates?: Record<string, unknown>;
  responsibles?: string[];
  followers?: string[];
  customFields?: Array<Record<string, unknown>>;
  parents?: string[];
}

export interface UpdateTaskInput {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  importance?: string;
  dates?: Record<string, unknown>;
  addResponsibles?: string[];
  removeResponsibles?: string[];
  customFields?: Array<Record<string, unknown>>;
}

// Folder types
export interface ListFoldersOptions {
  spaceId?: string;
  descendants?: boolean;
  fields?: string[];
  project?: boolean;
}

export interface CreateFolderInput {
  parentFolderId: string;
  title: string;
  description?: string;
  shareds?: string[];
  project?: Record<string, unknown>;
}

export interface UpdateFolderInput {
  id: string;
  title?: string;
  description?: string;
  addParents?: string[];
  removeParents?: string[];
  project?: Record<string, unknown>;
}

// Space types
export interface ListSpacesOptions {
  withArchived?: boolean;
  fields?: string[];
}

// Custom field types
export interface CreateCustomFieldInput {
  title: string;
  type: string;
  spaceId?: string;
  settings?: Record<string, unknown>;
  shareds?: string[];
}

// Comment types
export interface ListCommentsOptions {
  taskId?: string;
  folderId?: string;
  updatedDate?: string;
  limit?: number;
}

export interface CreateCommentInput {
  taskId?: string;
  folderId?: string;
  text: string;
  plainText?: boolean;
}

// Timelog types
export interface ListTimelogsOptions {
  taskId?: string;
  folderId?: string;
  contactId?: string;
  trackedDate?: string;
  createdDate?: string;
  updatedDate?: string;
}

export interface CreateTimelogInput {
  taskId: string;
  hours: number;
  trackedDate: string;
  comment?: string;
  categoryId?: string;
}

// Contact types
export interface ListContactsOptions {
  me?: boolean;
  metadata?: string;
  deleted?: boolean;
  fields?: string[];
}

// Invitation types
export interface SendInvitationInput {
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  external?: boolean;
  subject?: string;
  message?: string;
}

// Attachment types
export interface ListAttachmentsOptions {
  taskId?: string;
  folderId?: string;
  versions?: boolean;
}
