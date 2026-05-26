// ClickUp Connector
// Workspaces, spaces, folders, lists, and tasks management

import { ClickUpClient } from './client';
import type {
  ClickUpConfig,
  User,
  Workspace,
  Space,
  Folder,
  List,
  Task,
  Comment,
  Tag,
  Checklist,
  TimeEntry,
  Goal,
  Webhook,
  CreateSpaceInput,
  CreateFolderInput,
  CreateListInput,
  CreateTaskInput,
  UpdateTaskInput,
  CreateCommentInput,
  CreateChecklistInput,
  CreateChecklistItemInput,
  CreateWebhookInput,
  TasksResponse,
} from '../types';

export { ClickUpClient } from './client';

export class ClickUp {
  private client: ClickUpClient;

  constructor(config: ClickUpConfig) {
    this.client = new ClickUpClient(config);
  }

  // ============================================
  // User Operations
  // ============================================

  async getAuthorizedUser(): Promise<User> {
    const result = await this.client.get<{ user: User }>('/user');
    return result.user;
  }

  // ============================================
  // Workspace (Team) Operations
  // ============================================

  async listWorkspaces(): Promise<Workspace[]> {
    const result = await this.client.get<{ teams: Workspace[] }>('/team');
    return result.teams;
  }

  // ============================================
  // Space Operations
  // ============================================

  async listSpaces(teamId: string, options?: { archived?: boolean }): Promise<Space[]> {
    const result = await this.client.get<{ spaces: Space[] }>(`/team/${teamId}/space`, {
      archived: options?.archived,
    });
    return result.spaces;
  }

  async getSpace(spaceId: string): Promise<Space> {
    return this.client.get<Space>(`/space/${spaceId}`);
  }

  async createSpace(teamId: string, input: CreateSpaceInput): Promise<Space> {
    return this.client.post<Space>(`/team/${teamId}/space`, input);
  }

  async updateSpace(spaceId: string, input: Partial<CreateSpaceInput>): Promise<Space> {
    return this.client.put<Space>(`/space/${spaceId}`, input);
  }

  async deleteSpace(spaceId: string): Promise<void> {
    await this.client.delete(`/space/${spaceId}`);
  }

  // ============================================
  // Folder Operations
  // ============================================

  async listFolders(spaceId: string, options?: { archived?: boolean }): Promise<Folder[]> {
    const result = await this.client.get<{ folders: Folder[] }>(`/space/${spaceId}/folder`, {
      archived: options?.archived,
    });
    return result.folders;
  }

  async getFolder(folderId: string): Promise<Folder> {
    return this.client.get<Folder>(`/folder/${folderId}`);
  }

  async createFolder(spaceId: string, input: CreateFolderInput): Promise<Folder> {
    return this.client.post<Folder>(`/space/${spaceId}/folder`, input);
  }

  async updateFolder(folderId: string, input: CreateFolderInput): Promise<Folder> {
    return this.client.put<Folder>(`/folder/${folderId}`, input);
  }

  async deleteFolder(folderId: string): Promise<void> {
    await this.client.delete(`/folder/${folderId}`);
  }

  // ============================================
  // List Operations
  // ============================================

  async listLists(folderId: string, options?: { archived?: boolean }): Promise<List[]> {
    const result = await this.client.get<{ lists: List[] }>(`/folder/${folderId}/list`, {
      archived: options?.archived,
    });
    return result.lists;
  }

  async listFolderlessLists(spaceId: string, options?: { archived?: boolean }): Promise<List[]> {
    const result = await this.client.get<{ lists: List[] }>(`/space/${spaceId}/list`, {
      archived: options?.archived,
    });
    return result.lists;
  }

  async getList(listId: string): Promise<List> {
    return this.client.get<List>(`/list/${listId}`);
  }

  async createList(folderId: string, input: CreateListInput): Promise<List> {
    return this.client.post<List>(`/folder/${folderId}/list`, input);
  }

  async createFolderlessList(spaceId: string, input: CreateListInput): Promise<List> {
    return this.client.post<List>(`/space/${spaceId}/list`, input);
  }

  async updateList(listId: string, input: Partial<CreateListInput>): Promise<List> {
    return this.client.put<List>(`/list/${listId}`, input);
  }

  async deleteList(listId: string): Promise<void> {
    await this.client.delete(`/list/${listId}`);
  }

  // ============================================
  // Task Operations
  // ============================================

  async listTasks(listId: string, options?: {
    archived?: boolean;
    page?: number;
    order_by?: string;
    reverse?: boolean;
    subtasks?: boolean;
    statuses?: string[];
    include_closed?: boolean;
    assignees?: string[];
    due_date_gt?: number;
    due_date_lt?: number;
    date_created_gt?: number;
    date_created_lt?: number;
    date_updated_gt?: number;
    date_updated_lt?: number;
  }): Promise<TasksResponse> {
    return this.client.get<TasksResponse>(`/list/${listId}/task`, options);
  }

  async getTask(taskId: string, options?: {
    custom_task_ids?: boolean;
    team_id?: string;
    include_subtasks?: boolean;
  }): Promise<Task> {
    return this.client.get<Task>(`/task/${taskId}`, options);
  }

  async createTask(listId: string, input: CreateTaskInput): Promise<Task> {
    return this.client.post<Task>(`/list/${listId}/task`, input);
  }

  async updateTask(taskId: string, input: UpdateTaskInput, options?: {
    custom_task_ids?: boolean;
    team_id?: string;
  }): Promise<Task> {
    return this.client.put<Task>(`/task/${taskId}`, input, options);
  }

  async deleteTask(taskId: string, options?: {
    custom_task_ids?: boolean;
    team_id?: string;
  }): Promise<void> {
    await this.client.delete(`/task/${taskId}`, options);
  }

  // ============================================
  // Comment Operations
  // ============================================

  async listTaskComments(taskId: string, options?: {
    custom_task_ids?: boolean;
    team_id?: string;
    start?: number;
    start_id?: string;
  }): Promise<Comment[]> {
    const result = await this.client.get<{ comments: Comment[] }>(`/task/${taskId}/comment`, options);
    return result.comments;
  }

  async createTaskComment(taskId: string, input: CreateCommentInput, options?: {
    custom_task_ids?: boolean;
    team_id?: string;
  }): Promise<Comment> {
    return this.client.post<Comment>(`/task/${taskId}/comment`, input, options);
  }

  async listListComments(listId: string): Promise<Comment[]> {
    const result = await this.client.get<{ comments: Comment[] }>(`/list/${listId}/comment`);
    return result.comments;
  }

  async createListComment(listId: string, input: CreateCommentInput): Promise<Comment> {
    return this.client.post<Comment>(`/list/${listId}/comment`, input);
  }

  async updateComment(commentId: string, input: { comment_text: string; assignee?: number; resolved?: boolean }): Promise<Comment> {
    return this.client.put<Comment>(`/comment/${commentId}`, input);
  }

  async deleteComment(commentId: string): Promise<void> {
    await this.client.delete(`/comment/${commentId}`);
  }

  // ============================================
  // Tag Operations
  // ============================================

  async listSpaceTags(spaceId: string): Promise<Tag[]> {
    const result = await this.client.get<{ tags: Tag[] }>(`/space/${spaceId}/tag`);
    return result.tags;
  }

  async createSpaceTag(spaceId: string, tag: { name: string; tag_fg?: string; tag_bg?: string }): Promise<Tag> {
    return this.client.post<Tag>(`/space/${spaceId}/tag`, { tag });
  }

  async addTagToTask(taskId: string, tagName: string, options?: {
    custom_task_ids?: boolean;
    team_id?: string;
  }): Promise<void> {
    await this.client.post(`/task/${taskId}/tag/${tagName}`, {}, options);
  }

  async removeTagFromTask(taskId: string, tagName: string, options?: {
    custom_task_ids?: boolean;
    team_id?: string;
  }): Promise<void> {
    await this.client.delete(`/task/${taskId}/tag/${tagName}`, options);
  }

  // ============================================
  // Checklist Operations
  // ============================================

  async createChecklist(taskId: string, input: CreateChecklistInput, options?: {
    custom_task_ids?: boolean;
    team_id?: string;
  }): Promise<Checklist> {
    const result = await this.client.post<{ checklist: Checklist }>(`/task/${taskId}/checklist`, input, options);
    return result.checklist;
  }

  async updateChecklist(checklistId: string, input: { name?: string; position?: number }): Promise<Checklist> {
    const result = await this.client.put<{ checklist: Checklist }>(`/checklist/${checklistId}`, input);
    return result.checklist;
  }

  async deleteChecklist(checklistId: string): Promise<void> {
    await this.client.delete(`/checklist/${checklistId}`);
  }

  async createChecklistItem(checklistId: string, input: CreateChecklistItemInput): Promise<Checklist> {
    const result = await this.client.post<{ checklist: Checklist }>(`/checklist/${checklistId}/checklist_item`, input);
    return result.checklist;
  }

  async updateChecklistItem(checklistId: string, checklistItemId: string, input: {
    name?: string;
    assignee?: number | null;
    resolved?: boolean;
    parent?: string | null;
  }): Promise<Checklist> {
    const result = await this.client.put<{ checklist: Checklist }>(`/checklist/${checklistId}/checklist_item/${checklistItemId}`, input);
    return result.checklist;
  }

  async deleteChecklistItem(checklistId: string, checklistItemId: string): Promise<void> {
    await this.client.delete(`/checklist/${checklistId}/checklist_item/${checklistItemId}`);
  }

  // ============================================
  // Time Entry Operations
  // ============================================

  async listTimeEntries(teamId: string, options?: {
    start_date?: number;
    end_date?: number;
    assignee?: number;
    include_task_tags?: boolean;
    include_location_names?: boolean;
    space_id?: string;
    folder_id?: string;
    list_id?: string;
    task_id?: string;
  }): Promise<TimeEntry[]> {
    const result = await this.client.get<{ data: TimeEntry[] }>(`/team/${teamId}/time_entries`, options);
    return result.data;
  }

  async getTimeEntry(teamId: string, timerId: string): Promise<TimeEntry> {
    const result = await this.client.get<{ data: TimeEntry }>(`/team/${teamId}/time_entries/${timerId}`);
    return result.data;
  }

  // ============================================
  // Goal Operations
  // ============================================

  async listGoals(teamId: string, options?: { include_completed?: boolean }): Promise<Goal[]> {
    const result = await this.client.get<{ goals: Goal[] }>(`/team/${teamId}/goal`, options);
    return result.goals;
  }

  async getGoal(goalId: string): Promise<Goal> {
    const result = await this.client.get<{ goal: Goal }>(`/goal/${goalId}`);
    return result.goal;
  }

  async createGoal(teamId: string, input: {
    name: string;
    due_date: number;
    description?: string;
    multiple_owners?: boolean;
    owners?: number[];
    color?: string;
  }): Promise<Goal> {
    const result = await this.client.post<{ goal: Goal }>(`/team/${teamId}/goal`, input);
    return result.goal;
  }

  async updateGoal(goalId: string, input: {
    name?: string;
    due_date?: number;
    description?: string;
    color?: string;
    add_owners?: number[];
    rem_owners?: number[];
  }): Promise<Goal> {
    const result = await this.client.put<{ goal: Goal }>(`/goal/${goalId}`, input);
    return result.goal;
  }

  async deleteGoal(goalId: string): Promise<void> {
    await this.client.delete(`/goal/${goalId}`);
  }

  // ============================================
  // Webhook Operations
  // ============================================

  async listWebhooks(teamId: string): Promise<Webhook[]> {
    const result = await this.client.get<{ webhooks: Webhook[] }>(`/team/${teamId}/webhook`);
    return result.webhooks;
  }

  async createWebhook(teamId: string, input: CreateWebhookInput): Promise<Webhook> {
    const result = await this.client.post<{ webhook: Webhook }>(`/team/${teamId}/webhook`, input);
    return result.webhook;
  }

  async updateWebhook(webhookId: string, input: Partial<CreateWebhookInput>): Promise<Webhook> {
    const result = await this.client.put<{ webhook: Webhook }>(`/webhook/${webhookId}`, input);
    return result.webhook;
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.client.delete(`/webhook/${webhookId}`);
  }

  // ============================================
  // Utility Methods
  // ============================================

  getClient(): ClickUpClient {
    return this.client;
  }
}
