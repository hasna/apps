import {
  getClientId,
  getClientSecret,
  getAccessToken,
  getRefreshToken,
  setTokens,
  isTokenExpired,
} from '../utils/config';
import type {
  TaskList,
  TaskListsResponse,
  Task,
  TasksResponse,
  CreateTaskListParams,
  UpdateTaskListParams,
  CreateTaskParams,
  UpdateTaskParams,
  ListTasksParams,
  MoveTaskParams,
  OAuthTokens,
  GoogleTasksError,
  AuthenticationError,
} from '../types';

const TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';
const SCOPES = ['https://www.googleapis.com/auth/tasks'];

export class GoogleTasksClient {
  private accessToken?: string;

  constructor(accessToken?: string) {
    this.accessToken = accessToken;
  }

  /**
   * Generate OAuth authorization URL
   */
  static getAuthUrl(clientId: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
    });
    return `${OAUTH_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  static async exchangeCode(code: string, clientId: string, clientSecret: string): Promise<OAuthTokens> {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Failed to exchange code: ${error.error_description || response.statusText}`);
    }

    return response.json();
  }

  /**
   * Refresh access token
   */
  static async refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<OAuthTokens> {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Failed to refresh token: ${error.error_description || response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get a valid access token, refreshing if needed
   */
  private async getValidToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    let token = getAccessToken();
    if (!token) {
      throw new AuthenticationError();
    }

    // Check if token needs refresh
    if (isTokenExpired()) {
      const refreshToken = getRefreshToken();
      const clientId = getClientId();
      const clientSecret = getClientSecret();

      if (!refreshToken || !clientId || !clientSecret) {
        throw new AuthenticationError('Token expired and cannot refresh. Run "connect-googletasks auth login"');
      }

      const tokens = await GoogleTasksClient.refreshAccessToken(refreshToken, clientId, clientSecret);
      setTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in);
      token = tokens.access_token;
    }

    return token;
  }

  /**
   * Make authenticated API request
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    const token = await this.getValidToken();

    let url = `${TASKS_API_BASE}${path}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      }
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const message = error.error?.message || response.statusText;
      throw {
        name: 'GoogleTasksError',
        message,
        statusCode: response.status,
        details: error,
      } as GoogleTasksError;
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  // ============================================
  // Task Lists API
  // ============================================

  /**
   * List all task lists
   */
  async listTaskLists(maxResults?: number, pageToken?: string): Promise<TaskListsResponse> {
    return this.request<TaskListsResponse>('GET', '/users/@me/lists', undefined, {
      maxResults,
      pageToken,
    });
  }

  /**
   * Get a task list by ID
   */
  async getTaskList(taskListId: string): Promise<TaskList> {
    return this.request<TaskList>('GET', `/users/@me/lists/${taskListId}`);
  }

  /**
   * Create a new task list
   */
  async createTaskList(params: CreateTaskListParams): Promise<TaskList> {
    return this.request<TaskList>('POST', '/users/@me/lists', params);
  }

  /**
   * Update a task list
   */
  async updateTaskList(taskListId: string, params: UpdateTaskListParams): Promise<TaskList> {
    return this.request<TaskList>('PATCH', `/users/@me/lists/${taskListId}`, params);
  }

  /**
   * Delete a task list
   */
  async deleteTaskList(taskListId: string): Promise<void> {
    await this.request<void>('DELETE', `/users/@me/lists/${taskListId}`);
  }

  // ============================================
  // Tasks API
  // ============================================

  /**
   * List tasks in a task list
   */
  async listTasks(taskListId: string, params?: ListTasksParams): Promise<TasksResponse> {
    return this.request<TasksResponse>('GET', `/lists/${taskListId}/tasks`, undefined, {
      maxResults: params?.maxResults,
      pageToken: params?.pageToken,
      showCompleted: params?.showCompleted,
      showDeleted: params?.showDeleted,
      showHidden: params?.showHidden,
      updatedMin: params?.updatedMin,
      completedMin: params?.completedMin,
      completedMax: params?.completedMax,
      dueMin: params?.dueMin,
      dueMax: params?.dueMax,
    });
  }

  /**
   * Get a task by ID
   */
  async getTask(taskListId: string, taskId: string): Promise<Task> {
    return this.request<Task>('GET', `/lists/${taskListId}/tasks/${taskId}`);
  }

  /**
   * Create a new task
   */
  async createTask(taskListId: string, params: CreateTaskParams, parent?: string, previous?: string): Promise<Task> {
    return this.request<Task>('POST', `/lists/${taskListId}/tasks`, params, {
      parent,
      previous,
    });
  }

  /**
   * Update a task
   */
  async updateTask(taskListId: string, taskId: string, params: UpdateTaskParams): Promise<Task> {
    return this.request<Task>('PATCH', `/lists/${taskListId}/tasks/${taskId}`, params);
  }

  /**
   * Delete a task
   */
  async deleteTask(taskListId: string, taskId: string): Promise<void> {
    await this.request<void>('DELETE', `/lists/${taskListId}/tasks/${taskId}`);
  }

  /**
   * Complete a task
   */
  async completeTask(taskListId: string, taskId: string): Promise<Task> {
    return this.updateTask(taskListId, taskId, {
      status: 'completed',
      completed: new Date().toISOString(),
    });
  }

  /**
   * Uncomplete a task (mark as needs action)
   */
  async uncompleteTask(taskListId: string, taskId: string): Promise<Task> {
    return this.updateTask(taskListId, taskId, {
      status: 'needsAction',
    });
  }

  /**
   * Move a task to a different position
   */
  async moveTask(taskListId: string, taskId: string, params?: MoveTaskParams): Promise<Task> {
    return this.request<Task>('POST', `/lists/${taskListId}/tasks/${taskId}/move`, undefined, {
      parent: params?.parent,
      previous: params?.previous,
    });
  }

  /**
   * Clear completed tasks from a list
   */
  async clearCompleted(taskListId: string): Promise<void> {
    await this.request<void>('POST', `/lists/${taskListId}/clear`);
  }
}

export { getClientId, getClientSecret, getAccessToken, getRefreshToken };
