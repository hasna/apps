// Wrike Connector API

import { WrikeClient } from './client';
import type {
  WrikeConfig,
  WrikeApiResponse,
  ListTasksOptions,
  CreateTaskInput,
  UpdateTaskInput,
  ListFoldersOptions,
  CreateFolderInput,
  UpdateFolderInput,
  ListSpacesOptions,
  CreateCustomFieldInput,
  ListCommentsOptions,
  CreateCommentInput,
  ListTimelogsOptions,
  CreateTimelogInput,
  ListContactsOptions,
  SendInvitationInput,
  ListAttachmentsOptions,
} from '../types';

export { WrikeClient } from './client';

export class Wrike {
  private client: WrikeClient;

  constructor(config: WrikeConfig) {
    this.client = new WrikeClient(config);
  }

  // ============================================
  // Tasks
  // ============================================

  async listTasks(options: ListTasksOptions = {}): Promise<WrikeApiResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      status: options.status,
      importance: options.importance,
      createdDate: options.createdDate,
      updatedDate: options.updatedDate,
      descendants: options.descendants,
      subTasks: options.subTasks,
      pageSize: options.pageSize,
      nextPageToken: options.nextPageToken,
      fields: options.fields ? JSON.stringify(options.fields) : undefined,
    };

    const path = options.folderId
      ? `/folders/${encodeURIComponent(options.folderId)}/tasks`
      : '/tasks';

    return this.client.get<WrikeApiResponse>(path, params);
  }

  async getTask(id: string): Promise<WrikeApiResponse> {
    return this.client.get<WrikeApiResponse>(`/tasks/${encodeURIComponent(id)}`);
  }

  async createTask(input: CreateTaskInput): Promise<WrikeApiResponse> {
    const { folderId, title, ...rest } = input;
    return this.client.post<WrikeApiResponse>(
      `/folders/${encodeURIComponent(folderId)}/tasks`,
      { title, ...rest },
    );
  }

  async updateTask(input: UpdateTaskInput): Promise<WrikeApiResponse> {
    const { id, ...body } = input;
    return this.client.put<WrikeApiResponse>(`/tasks/${encodeURIComponent(id)}`, body);
  }

  async deleteTask(id: string): Promise<WrikeApiResponse> {
    return this.client.delete<WrikeApiResponse>(`/tasks/${encodeURIComponent(id)}`);
  }

  // ============================================
  // Folders
  // ============================================

  async listFolders(options: ListFoldersOptions = {}): Promise<WrikeApiResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      descendants: options.descendants,
      fields: options.fields ? JSON.stringify(options.fields) : undefined,
      project: options.project,
    };

    const path = options.spaceId
      ? `/spaces/${encodeURIComponent(options.spaceId)}/folders`
      : '/folders';

    return this.client.get<WrikeApiResponse>(path, params);
  }

  async getFolder(id: string): Promise<WrikeApiResponse> {
    return this.client.get<WrikeApiResponse>(`/folders/${encodeURIComponent(id)}`);
  }

  async createFolder(input: CreateFolderInput): Promise<WrikeApiResponse> {
    const { parentFolderId, title, ...rest } = input;
    return this.client.post<WrikeApiResponse>(
      `/folders/${encodeURIComponent(parentFolderId)}/folders`,
      { title, ...rest },
    );
  }

  async updateFolder(input: UpdateFolderInput): Promise<WrikeApiResponse> {
    const { id, ...body } = input;
    return this.client.put<WrikeApiResponse>(`/folders/${encodeURIComponent(id)}`, body);
  }

  async deleteFolder(id: string): Promise<WrikeApiResponse> {
    return this.client.delete<WrikeApiResponse>(`/folders/${encodeURIComponent(id)}`);
  }

  // ============================================
  // Spaces
  // ============================================

  async listSpaces(options: ListSpacesOptions = {}): Promise<WrikeApiResponse> {
    return this.client.get<WrikeApiResponse>('/spaces', {
      withArchived: options.withArchived,
      fields: options.fields ? JSON.stringify(options.fields) : undefined,
    });
  }

  async getSpace(id: string): Promise<WrikeApiResponse> {
    return this.client.get<WrikeApiResponse>(`/spaces/${encodeURIComponent(id)}`);
  }

  // ============================================
  // Workflows & Custom Fields
  // ============================================

  async listWorkflows(): Promise<WrikeApiResponse> {
    return this.client.get<WrikeApiResponse>('/workflows');
  }

  async listCustomFields(): Promise<WrikeApiResponse> {
    return this.client.get<WrikeApiResponse>('/customfields');
  }

  async createCustomField(input: CreateCustomFieldInput): Promise<WrikeApiResponse> {
    return this.client.post<WrikeApiResponse>('/customfields', input as unknown as Record<string, unknown>);
  }

  // ============================================
  // Comments
  // ============================================

  async listComments(options: ListCommentsOptions = {}): Promise<WrikeApiResponse> {
    const params = {
      updatedDate: options.updatedDate,
      limit: options.limit,
    };

    const path = options.taskId
      ? `/tasks/${encodeURIComponent(options.taskId)}/comments`
      : options.folderId
        ? `/folders/${encodeURIComponent(options.folderId)}/comments`
        : '/comments';

    return this.client.get<WrikeApiResponse>(path, params);
  }

  async createComment(input: CreateCommentInput): Promise<WrikeApiResponse> {
    const { taskId, folderId, ...body } = input;
    const path = taskId
      ? `/tasks/${encodeURIComponent(taskId)}/comments`
      : folderId
        ? `/folders/${encodeURIComponent(folderId)}/comments`
        : null;

    if (!path) {
      throw new Error('taskId or folderId is required to create a comment');
    }

    return this.client.post<WrikeApiResponse>(path, body);
  }

  async deleteComment(id: string): Promise<WrikeApiResponse> {
    return this.client.delete<WrikeApiResponse>(`/comments/${encodeURIComponent(id)}`);
  }

  // ============================================
  // Timelogs
  // ============================================

  async listTimelogs(options: ListTimelogsOptions = {}): Promise<WrikeApiResponse> {
    const params = {
      trackedDate: options.trackedDate,
      createdDate: options.createdDate,
      updatedDate: options.updatedDate,
    };

    const path = options.taskId
      ? `/tasks/${encodeURIComponent(options.taskId)}/timelogs`
      : options.folderId
        ? `/folders/${encodeURIComponent(options.folderId)}/timelogs`
        : options.contactId
          ? `/contacts/${encodeURIComponent(options.contactId)}/timelogs`
          : '/timelogs';

    return this.client.get<WrikeApiResponse>(path, params);
  }

  async createTimelog(input: CreateTimelogInput): Promise<WrikeApiResponse> {
    const { taskId, ...body } = input;
    return this.client.post<WrikeApiResponse>(
      `/tasks/${encodeURIComponent(taskId)}/timelogs`,
      body,
    );
  }

  async deleteTimelog(id: string): Promise<WrikeApiResponse> {
    return this.client.delete<WrikeApiResponse>(`/timelogs/${encodeURIComponent(id)}`);
  }

  // ============================================
  // Contacts & Groups
  // ============================================

  async listContacts(options: ListContactsOptions = {}): Promise<WrikeApiResponse> {
    return this.client.get<WrikeApiResponse>('/contacts', {
      me: options.me,
      metadata: options.metadata,
      deleted: options.deleted,
      fields: options.fields ? JSON.stringify(options.fields) : undefined,
    });
  }

  async getContact(id: string): Promise<WrikeApiResponse> {
    return this.client.get<WrikeApiResponse>(`/contacts/${encodeURIComponent(id)}`);
  }

  async listGroups(options: { fields?: string[] } = {}): Promise<WrikeApiResponse> {
    return this.client.get<WrikeApiResponse>('/groups', {
      fields: options.fields ? JSON.stringify(options.fields) : undefined,
    });
  }

  // ============================================
  // Invitations
  // ============================================

  async listInvitations(): Promise<WrikeApiResponse> {
    return this.client.get<WrikeApiResponse>('/invitations');
  }

  async sendInvitation(input: SendInvitationInput): Promise<WrikeApiResponse> {
    return this.client.post<WrikeApiResponse>('/invitations', input as unknown as Record<string, unknown>);
  }

  // ============================================
  // Attachments
  // ============================================

  async listAttachments(options: ListAttachmentsOptions = {}): Promise<WrikeApiResponse> {
    const path = options.taskId
      ? `/tasks/${encodeURIComponent(options.taskId)}/attachments`
      : options.folderId
        ? `/folders/${encodeURIComponent(options.folderId)}/attachments`
        : '/attachments';

    return this.client.get<WrikeApiResponse>(path, { versions: options.versions });
  }

  // ============================================
  // Version
  // ============================================

  async getVersion(): Promise<WrikeApiResponse> {
    return this.client.get<WrikeApiResponse>('/version');
  }

  getClient(): WrikeClient {
    return this.client;
  }
}
