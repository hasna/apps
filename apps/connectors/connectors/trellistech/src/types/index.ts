// Trellis Tech Public API v1 Types
// https://docs.trellistech.com/api-reference

export interface TrellistechConfig {
  apiKey: string;
  workspaceId: string;
  baseUrl?: string;
}

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type PropertyStatus = 'PROSPECT' | 'ONBOARDING' | 'ACTIVE' | 'AT_RISK' | 'INACTIVE';

export type PropertyLifecycleStage =
  | 'PROSPECT'
  | 'ONBOARDING'
  | 'ACTIVE'
  | 'AT_RISK'
  | 'PAUSED'
  | 'INACTIVE'
  | 'CHURNED'
  | null;

export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface Property {
  id: string;
  workspaceId: string;
  sourceIntegrationId: string | null;
  name: string;
  internalName: string | null;
  internalCode: string | null;
  status: PropertyStatus;
  lifecycleStage: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  propertyType: string | null;
  timezone: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  beds: number | null;
  maxGuests: number | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface ListPropertiesResponse {
  items: Property[];
  pagination: PaginationMeta;
}

export interface GetPropertyResponse {
  property: Property;
}

export interface MutatePropertyResponse {
  property: Property;
}

export interface DeletePropertyResponse {
  deleted: boolean;
  propertyId: string;
}

export interface CreatePropertyRequest {
  name: string;
  status?: PropertyStatus;
  lifecycleStage?: PropertyLifecycleStage;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  propertyType?: string | null;
  customFields?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UpdatePropertyRequest {
  name?: string;
  status?: PropertyStatus;
  lifecycleStage?: PropertyLifecycleStage;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  propertyType?: string | null;
  customFields?: Record<string, unknown>;
  [key: string]: unknown;
}

export type TaskStatus =
  | 'OPEN'
  | 'CREATED'
  | 'DRAFT'
  | 'DRAFTED'
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'FINISHED'
  | 'CLOSED'
  | 'PENDING_APPROVAL'
  | 'REQUEST_APPROVED'
  | 'REQUEST_REJECTED'
  | 'COMPLETED';

export type Priority = 'WATCH' | 'LOWEST' | 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export type TaskSource =
  | 'MANUAL'
  | 'AUTOMATION'
  | 'SCHEDULE_RULE'
  | 'INTEGRATION'
  | 'AI'
  | 'REVIEW'
  | 'MESSAGE'
  | 'CALL'
  | 'MEETING_BOT';

export interface Task {
  id: string;
  shortId: string;
  workspaceId: string;
  propertyId: string | null;
  departmentId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  source: TaskSource;
  scheduledDate: string | null;
  scheduledTime: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface ListTasksResponse {
  items: Task[];
  pagination: PaginationMeta;
}

export interface GetTaskResponse {
  task: Task;
}

export interface MutateTaskResponse {
  task: Task;
}

export interface DeleteTaskResponse {
  deleted: boolean;
  taskId: string;
}

export interface CreateTaskRequest {
  title: string;
  departmentId: string;
  description?: string | null;
  propertyId?: string | null;
  priority?: Priority;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  source?: TaskSource;
  isIssue?: boolean;
  [key: string]: unknown;
}

export interface UpdateTaskRequest {
  title?: string;
  departmentId?: string;
  description?: string | null;
  propertyId?: string | null;
  priority?: Priority;
  status?: TaskStatus;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  summary?: string | null;
  [key: string]: unknown;
}

export interface ListPropertiesParams {
  limit?: number;
  offset?: number;
  status?: PropertyStatus;
  q?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface ListTasksParams {
  limit?: number;
  offset?: number;
  status?: TaskStatus;
  priority?: Priority;
  propertyId?: string;
  departmentId?: string;
  scheduledFrom?: string;
  scheduledTo?: string;
  scheduledDate?: string;
  q?: string;
  include?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface ApiErrorBody {
  error: string;
  message?: string;
  details?: unknown;
}

export class TrellistechApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode?: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number,
    options?: { errorCode?: string; details?: unknown }
  ) {
    super(message);
    this.name = 'TrellistechApiError';
    this.statusCode = statusCode;
    this.errorCode = options?.errorCode;
    this.details = options?.details;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }

  getUserMessage(): string {
    switch (this.statusCode) {
      case 401:
        return 'Authentication failed. Check TRELLISTECH_API_KEY.';
      case 403:
        return 'Access denied. Workspace ID must match the API key scope.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      default:
        return this.message;
    }
  }
}

export function parseApiError(response: unknown, statusCode: number): TrellistechApiError {
  if (typeof response === 'string') {
    return new TrellistechApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new TrellistechApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as ApiErrorBody;
  const message = data.message || data.error || `HTTP ${statusCode} Error`;

  return new TrellistechApiError(message, statusCode, {
    errorCode: data.error,
    details: data.details,
  });
}
