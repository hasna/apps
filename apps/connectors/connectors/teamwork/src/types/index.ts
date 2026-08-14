// Teamwork API Types
//
// Built against the public Teamwork.com API v3 (https://apidocs.teamwork.com/).
// Endpoints live under `/projects/api/v3` and authenticate with HTTP Basic auth
// using an API token as the username.

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey?: string;       // Teamwork API token (used as the Basic auth username)
  token?: string;        // Alias for apiKey
  installation?: string; // Teamwork site name (subdomain of {installation}.teamwork.com)
  baseUrl?: string;      // Override default base URL (https://{installation}.teamwork.com)
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

/** Pagination metadata returned under `meta.page` for v3 list endpoints. */
export interface PageMeta {
  pageOffset?: number;
  pageSize?: number;
  count?: number;
  hasMore?: boolean;
}

export interface ResponseMeta {
  page?: PageMeta;
}

/** Common query parameters accepted by v3 list endpoints. */
export interface ListParams {
  page?: number;
  pageSize?: number;
  searchTerm?: string;
  orderBy?: string;
  orderMode?: 'asc' | 'desc';
  include?: string;
}

// ============================================
// Project Types
// ============================================

export interface Project {
  id: number;
  name: string;
  description?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  createdAt?: string;
  updatedAt?: string;
  companyId?: number;
  category?: { id: number; name: string } | null;
  tags?: unknown[];
}

export interface ProjectResponse {
  project: Project;
  included?: Record<string, unknown>;
}

export interface ProjectsResponse {
  projects: Project[];
  included?: Record<string, unknown>;
  meta?: ResponseMeta;
}

export interface CreateProjectParams {
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  companyId?: number;
  categoryId?: number;
}

export interface UpdateProjectParams {
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
}

// ============================================
// Task Types
// ============================================

export interface Task {
  id: number;
  name: string;
  description?: string;
  status?: string;
  priority?: string;
  progress?: number;
  startDate?: string;
  dueDate?: string;
  completedAt?: string;
  tasklistId?: number;
  projectId?: number;
  parentTaskId?: number;
  createdAt?: string;
  createdBy?: number;
  assigneeUserIds?: number[];
}

export interface TaskResponse {
  task: Task;
  included?: Record<string, unknown>;
}

export interface TasksResponse {
  tasks: Task[];
  included?: Record<string, unknown>;
  meta?: ResponseMeta;
}

export interface CreateTaskParams {
  name: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  startDate?: string;
  dueDate?: string;
  progress?: number;
  assignees?: { userIds?: number[] };
}

export interface UpdateTaskParams {
  name?: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  startDate?: string;
  dueDate?: string;
  progress?: number;
}

// ============================================
// Tasklist Types
// ============================================

export interface Tasklist {
  id: number;
  name: string;
  description?: string;
  projectId?: number;
  milestoneId?: number;
  position?: number;
}

export interface TasklistResponse {
  tasklist: Tasklist;
  included?: Record<string, unknown>;
}

export interface TasklistsResponse {
  tasklists: Tasklist[];
  included?: Record<string, unknown>;
  meta?: ResponseMeta;
}

export interface CreateTasklistParams {
  name: string;
  description?: string;
  milestoneId?: number;
}

// ============================================
// Milestone Types
// ============================================

export interface Milestone {
  id: number;
  name: string;
  description?: string;
  deadline?: string;
  status?: string;
  completed?: boolean;
  projectId?: number;
  responsiblePartyIds?: number[];
}

export interface MilestoneResponse {
  milestone: Milestone;
  included?: Record<string, unknown>;
}

export interface MilestonesResponse {
  milestones: Milestone[];
  included?: Record<string, unknown>;
  meta?: ResponseMeta;
}

// ============================================
// Person Types
// ============================================

export interface Person {
  id: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  title?: string;
  companyId?: number;
  isAdmin?: boolean;
  type?: string;
  avatarUrl?: string;
}

export interface PersonResponse {
  person: Person;
  included?: Record<string, unknown>;
}

export interface PeopleResponse {
  people: Person[];
  included?: Record<string, unknown>;
  meta?: ResponseMeta;
}

// ============================================
// Company Types
// ============================================

export interface Company {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  website?: string;
  countryCode?: string;
  createdAt?: string;
}

export interface CompanyResponse {
  company: Company;
  included?: Record<string, unknown>;
}

export interface CompaniesResponse {
  companies: Company[];
  included?: Record<string, unknown>;
  meta?: ResponseMeta;
}

// ============================================
// Time Entry Types
// ============================================

export interface TimeEntry {
  id: number;
  description?: string;
  minutes?: number;
  hours?: number;
  date?: string;
  isBillable?: boolean;
  userId?: number;
  projectId?: number;
  taskId?: number;
}

export interface TimeEntriesResponse {
  timelogs: TimeEntry[];
  included?: Record<string, unknown>;
  meta?: ResponseMeta;
}

// ============================================
// Comment Types
// ============================================

export interface Comment {
  id: number;
  body?: string;
  htmlBody?: string;
  createdAt?: string;
  userId?: number;
  objectId?: number;
  objectType?: string;
}

export interface CommentsResponse {
  comments: Comment[];
  included?: Record<string, unknown>;
  meta?: ResponseMeta;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code?: string;
  title?: string;
  detail?: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(
    message: string,
    statusCode: number,
    options?: {
      errors?: ApiErrorDetail[];
    }
  ) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isServerError(): boolean {
    return this.statusCode >= 500 && this.statusCode < 600;
  }

  isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }

  getUserMessage(): string {
    switch (this.statusCode) {
      case 400:
        return 'Bad request. Please check your input.';
      case 401:
        return 'Authentication failed. Please check your API token.';
      case 403:
        return 'Access denied. You do not have permission to perform this action.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      case 500:
        return 'Server error. Please try again later.';
      default:
        return this.message;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      errors: this.errors,
    };
  }
}

export function parseApiError(
  response: unknown,
  statusCode: number
): ConnectorApiError {
  if (typeof response === 'string') {
    return new ConnectorApiError(response || `HTTP ${statusCode} Error`, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new ConnectorApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;

  // Teamwork v3 returns errors as { errors: [{ code, title, detail }] }.
  // Older/legacy responses may use { MESSAGE } or { message }.
  const errorList = Array.isArray(data.errors)
    ? (data.errors as ApiErrorDetail[])
    : undefined;

  const message =
    errorList?.map((e) => e.detail || e.title).filter(Boolean).join('; ') ||
    (data.MESSAGE as string) ||
    (data.message as string) ||
    (data.error as string) ||
    `HTTP ${statusCode} Error`;

  return new ConnectorApiError(message, statusCode, { errors: errorList });
}
