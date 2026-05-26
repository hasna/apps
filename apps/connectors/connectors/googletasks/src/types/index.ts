/**
 * Google Tasks API Types
 */

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface GoogleTasksConfig {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
}

export interface ProfileConfig extends GoogleTasksConfig {}

// ============================================
// OAuth Types
// ============================================

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

// ============================================
// Task List Types
// ============================================

export interface TaskList {
  kind: 'tasks#taskList';
  id: string;
  etag: string;
  title: string;
  updated: string;
  selfLink: string;
}

export interface TaskListsResponse {
  kind: 'tasks#taskLists';
  etag: string;
  nextPageToken?: string;
  items: TaskList[];
}

export interface CreateTaskListParams {
  title: string;
}

export interface UpdateTaskListParams {
  title?: string;
}

// ============================================
// Task Types
// ============================================

export type TaskStatus = 'needsAction' | 'completed';

export interface TaskLink {
  type: string;
  description: string;
  link: string;
}

export interface Task {
  kind: 'tasks#task';
  id: string;
  etag: string;
  title: string;
  updated: string;
  selfLink: string;
  parent?: string;
  position: string;
  notes?: string;
  status: TaskStatus;
  due?: string;
  completed?: string;
  deleted?: boolean;
  hidden?: boolean;
  links?: TaskLink[];
}

export interface TasksResponse {
  kind: 'tasks#tasks';
  etag: string;
  nextPageToken?: string;
  items?: Task[];
}

export interface CreateTaskParams {
  title: string;
  notes?: string;
  due?: string;
  status?: TaskStatus;
  parent?: string;
  previous?: string;
}

export interface UpdateTaskParams {
  title?: string;
  notes?: string;
  due?: string;
  status?: TaskStatus;
  completed?: string;
}

export interface ListTasksParams {
  maxResults?: number;
  pageToken?: string;
  showCompleted?: boolean;
  showDeleted?: boolean;
  showHidden?: boolean;
  updatedMin?: string;
  completedMin?: string;
  completedMax?: string;
  dueMin?: string;
  dueMax?: string;
}

export interface MoveTaskParams {
  parent?: string;
  previous?: string;
}

// ============================================
// Error Types
// ============================================

export class GoogleTasksError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'GoogleTasksError';
  }
}

export class AuthenticationError extends GoogleTasksError {
  constructor(message = 'Authentication required. Run "connect-googletasks auth login"') {
    super(message, 401);
    this.name = 'AuthenticationError';
  }
}

export class TokenExpiredError extends GoogleTasksError {
  constructor(message = 'Access token expired. Run "connect-googletasks auth refresh"') {
    super(message, 401);
    this.name = 'TokenExpiredError';
  }
}
