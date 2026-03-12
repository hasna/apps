// Jira Connector
// Projects, issues, boards, and sprints management

import { JiraClient } from './client';
import type {
  JiraConfig,
  User,
  Project,
  Issue,
  Comment,
  Transition,
  Board,
  Sprint,
  SearchResponse,
  PaginatedResponse,
  CreateIssueInput,
  UpdateIssueInput,
  TransitionIssueInput,
  CreateCommentInput,
} from '../types';

export { JiraClient } from './client';

export class Jira {
  private client: JiraClient;
  private agileBaseUrl: string;

  constructor(config: JiraConfig) {
    this.client = new JiraClient(config);
    this.agileBaseUrl = config.baseUrl?.replace('/rest/api/3', '/rest/agile/1.0') ||
      `https://${config.domain}/rest/agile/1.0`;
  }

  // ============================================
  // User Operations
  // ============================================

  async getMyself(): Promise<User> {
    return this.client.get<User>('/myself');
  }

  async searchUsers(options: {
    query?: string;
    accountId?: string;
    startAt?: number;
    maxResults?: number;
  }): Promise<User[]> {
    return this.client.get<User[]>('/user/search', options);
  }

  // ============================================
  // Project Operations
  // ============================================

  async listProjects(options?: {
    startAt?: number;
    maxResults?: number;
    orderBy?: string;
    expand?: string;
  }): Promise<PaginatedResponse<Project>> {
    return this.client.get<PaginatedResponse<Project>>('/project/search', options);
  }

  async getProject(projectIdOrKey: string, options?: { expand?: string }): Promise<Project> {
    return this.client.get<Project>(`/project/${projectIdOrKey}`, options);
  }

  // ============================================
  // Issue Operations
  // ============================================

  async searchIssues(options: {
    jql: string;
    startAt?: number;
    maxResults?: number;
    fields?: string[];
    expand?: string;
  }): Promise<SearchResponse<Issue>> {
    return this.client.post<SearchResponse<Issue>>('/search', {
      jql: options.jql,
      startAt: options.startAt,
      maxResults: options.maxResults,
      fields: options.fields,
      expand: options.expand,
    });
  }

  async getIssue(issueIdOrKey: string, options?: {
    fields?: string[];
    expand?: string;
  }): Promise<Issue> {
    return this.client.get<Issue>(`/issue/${issueIdOrKey}`, {
      fields: options?.fields?.join(','),
      expand: options?.expand,
    });
  }

  async createIssue(input: CreateIssueInput): Promise<Issue> {
    return this.client.post<Issue>('/issue', input);
  }

  async updateIssue(issueIdOrKey: string, input: UpdateIssueInput): Promise<void> {
    await this.client.put(`/issue/${issueIdOrKey}`, input);
  }

  async deleteIssue(issueIdOrKey: string, options?: { deleteSubtasks?: boolean }): Promise<void> {
    await this.client.delete(`/issue/${issueIdOrKey}`, {
      deleteSubtasks: options?.deleteSubtasks,
    });
  }

  async assignIssue(issueIdOrKey: string, accountId: string | null): Promise<void> {
    await this.client.put(`/issue/${issueIdOrKey}/assignee`, { accountId });
  }

  // ============================================
  // Transition Operations
  // ============================================

  async getTransitions(issueIdOrKey: string): Promise<{ transitions: Transition[] }> {
    return this.client.get<{ transitions: Transition[] }>(`/issue/${issueIdOrKey}/transitions`);
  }

  async transitionIssue(issueIdOrKey: string, input: TransitionIssueInput): Promise<void> {
    await this.client.post(`/issue/${issueIdOrKey}/transitions`, input);
  }

  // ============================================
  // Comment Operations
  // ============================================

  async getComments(issueIdOrKey: string, options?: {
    startAt?: number;
    maxResults?: number;
    orderBy?: string;
    expand?: string;
  }): Promise<{ comments: Comment[]; startAt: number; maxResults: number; total: number }> {
    return this.client.get(`/issue/${issueIdOrKey}/comment`, options);
  }

  async addComment(issueIdOrKey: string, input: CreateCommentInput): Promise<Comment> {
    return this.client.post<Comment>(`/issue/${issueIdOrKey}/comment`, input);
  }

  async updateComment(issueIdOrKey: string, commentId: string, input: CreateCommentInput): Promise<Comment> {
    return this.client.put<Comment>(`/issue/${issueIdOrKey}/comment/${commentId}`, input);
  }

  async deleteComment(issueIdOrKey: string, commentId: string): Promise<void> {
    await this.client.delete(`/issue/${issueIdOrKey}/comment/${commentId}`);
  }

  // ============================================
  // Board Operations (Agile)
  // ============================================

  async listBoards(options?: {
    startAt?: number;
    maxResults?: number;
    type?: 'scrum' | 'kanban' | 'simple';
    name?: string;
    projectKeyOrId?: string;
  }): Promise<PaginatedResponse<Board>> {
    const url = this.agileBaseUrl + '/board';
    const response = await fetch(this.buildAgileUrl(url, options), {
      headers: this.getAgileHeaders(),
    });
    return response.json();
  }

  async getBoard(boardId: number): Promise<Board> {
    const url = this.agileBaseUrl + `/board/${boardId}`;
    const response = await fetch(url, {
      headers: this.getAgileHeaders(),
    });
    return response.json();
  }

  async getBoardIssues(boardId: number, options?: {
    startAt?: number;
    maxResults?: number;
    jql?: string;
  }): Promise<SearchResponse<Issue>> {
    const url = this.agileBaseUrl + `/board/${boardId}/issue`;
    const response = await fetch(this.buildAgileUrl(url, options), {
      headers: this.getAgileHeaders(),
    });
    return response.json();
  }

  // ============================================
  // Sprint Operations
  // ============================================

  async listSprints(boardId: number, options?: {
    startAt?: number;
    maxResults?: number;
    state?: 'future' | 'active' | 'closed';
  }): Promise<PaginatedResponse<Sprint>> {
    const url = this.agileBaseUrl + `/board/${boardId}/sprint`;
    const response = await fetch(this.buildAgileUrl(url, options), {
      headers: this.getAgileHeaders(),
    });
    return response.json();
  }

  async getSprint(sprintId: number): Promise<Sprint> {
    const url = this.agileBaseUrl + `/sprint/${sprintId}`;
    const response = await fetch(url, {
      headers: this.getAgileHeaders(),
    });
    return response.json();
  }

  async getSprintIssues(sprintId: number, options?: {
    startAt?: number;
    maxResults?: number;
    jql?: string;
  }): Promise<SearchResponse<Issue>> {
    const url = this.agileBaseUrl + `/sprint/${sprintId}/issue`;
    const response = await fetch(this.buildAgileUrl(url, options), {
      headers: this.getAgileHeaders(),
    });
    return response.json();
  }

  async moveIssuesToSprint(sprintId: number, issueKeys: string[]): Promise<void> {
    const url = this.agileBaseUrl + `/sprint/${sprintId}/issue`;
    await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getAgileHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ issues: issueKeys }),
    });
  }

  // ============================================
  // Helper Methods
  // ============================================

  private getAgileHeaders(): Record<string, string> {
    const credentials = Buffer.from(`${(this.client as any).email}:${(this.client as any).apiToken}`).toString('base64');
    return {
      'Authorization': `Basic ${credentials}`,
      'Accept': 'application/json',
    };
  }

  private buildAgileUrl(baseUrl: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(baseUrl);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }
    return url.toString();
  }

  getClient(): JiraClient {
    return this.client;
  }
}
