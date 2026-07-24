import type {
  SmartsheetConfig,
  ListSheetsResult,
  Sheet,
  CreateSheetParams,
  AddRowsParams,
  UpdateRowsParams,
  ListFoldersResult,
  Folder,
  ListWorkspacesResult,
  Workspace,
  ListReportsResult,
  ReportSummary,
  ListWebhooksResult,
  Webhook,
  CreateWebhookParams,
  ListUsersResult,
  User,
  InviteUserParams,
  ListContactsResult,
  ListDiscussionsResult,
  Discussion,
  ListAttachmentsResult,
  ListAutomationRulesResult,
  Column,
} from '../types';
import { SmartsheetClient } from './client';

/**
 * Smartsheet REST API 2.0 wrapper
 */
export class Smartsheet {
  private readonly client: SmartsheetClient;

  constructor(config: SmartsheetConfig) {
    this.client = new SmartsheetClient(config);
  }

  static fromEnv(): Smartsheet {
    const accessToken = process.env.SMARTSHEET_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('SMARTSHEET_ACCESS_TOKEN environment variable is required');
    }
    return new Smartsheet({ accessToken });
  }

  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  getClient(): SmartsheetClient {
    return this.client;
  }

  // ============================================
  // Sheets
  // ============================================

  async listSheets(params?: {
    include?: string[];
    modifiedSince?: string;
    page?: number;
    pageSize?: number;
    includeAll?: boolean;
  }): Promise<ListSheetsResult> {
    return this.client.get<ListSheetsResult>('/sheets', {
      include: params?.include?.join(','),
      modifiedSince: params?.modifiedSince,
      page: params?.page,
      pageSize: params?.pageSize,
      includeAll: params?.includeAll,
    });
  }

  async getSheet(
    id: number,
    params?: { include?: string[]; exclude?: string[]; columnIds?: number[]; rowIds?: number[] },
  ): Promise<Sheet> {
    return this.client.get<Sheet>(`/sheets/${id}`, {
      include: params?.include?.join(','),
      exclude: params?.exclude?.join(','),
      columnIds: params?.columnIds?.join(','),
      rowIds: params?.rowIds?.join(','),
    });
  }

  async createSheet(params: CreateSheetParams): Promise<Sheet> {
    const path = params.folderId
      ? `/folders/${params.folderId}/sheets`
      : params.workspaceId
        ? `/workspaces/${params.workspaceId}/sheets`
        : '/sheets';

    return this.client.post<Sheet>(path, {
      name: params.name,
      columns: params.columns,
    });
  }

  async updateSheet(
    id: number,
    params: { name?: string; projectSettings?: Record<string, unknown> },
  ): Promise<Sheet> {
    return this.client.put<Sheet>(`/sheets/${id}`, params);
  }

  async deleteSheet(id: number): Promise<void> {
    await this.client.delete(`/sheets/${id}`);
  }

  // ============================================
  // Rows
  // ============================================

  async addRows(params: AddRowsParams): Promise<{ result: unknown[] }> {
    const rows = params.rows.map((row) => ({
      ...row,
      toTop: params.toTop,
      toBottom: params.toBottom,
      aboveRowId: params.aboveRowId,
      belowRowId: params.belowRowId,
    }));
    return this.client.post<{ result: unknown[] }>(`/sheets/${params.sheetId}/rows`, rows);
  }

  async updateRows(params: UpdateRowsParams): Promise<{ result: unknown[] }> {
    return this.client.put<{ result: unknown[] }>(`/sheets/${params.sheetId}/rows`, params.rows);
  }

  async deleteRows(sheetId: number, rowIds: number[], ignoreRowsNotFound?: boolean): Promise<void> {
    await this.client.delete(`/sheets/${sheetId}/rows`, {
      ids: rowIds.join(','),
      ignoreRowsNotFound,
    });
  }

  async getRow(
    sheetId: number,
    rowId: number,
    params?: { include?: string[]; exclude?: string[] },
  ): Promise<unknown> {
    return this.client.get(`/sheets/${sheetId}/rows/${rowId}`, {
      include: params?.include?.join(','),
      exclude: params?.exclude?.join(','),
    });
  }

  // ============================================
  // Columns
  // ============================================

  async addColumns(sheetId: number, columns: Array<Record<string, unknown>>): Promise<{ result: Column[] }> {
    return this.client.post<{ result: Column[] }>(`/sheets/${sheetId}/columns`, columns);
  }

  async listColumns(
    sheetId: number,
    params?: { include?: string[]; page?: number; pageSize?: number },
  ): Promise<{ data: Column[] }> {
    return this.client.get(`/sheets/${sheetId}/columns`, {
      include: params?.include?.join(','),
      page: params?.page,
      pageSize: params?.pageSize,
    });
  }

  async deleteColumn(sheetId: number, columnId: number): Promise<void> {
    await this.client.delete(`/sheets/${sheetId}/columns/${columnId}`);
  }

  // ============================================
  // Folders
  // ============================================

  async listFolders(params?: {
    parentId?: number;
    workspaceId?: number;
    page?: number;
    pageSize?: number;
  }): Promise<ListFoldersResult> {
    const base = params?.parentId
      ? `/folders/${params.parentId}/folders`
      : params?.workspaceId
        ? `/workspaces/${params.workspaceId}/folders`
        : '/home/folders';

    return this.client.get<ListFoldersResult>(base, {
      page: params?.page,
      pageSize: params?.pageSize,
    });
  }

  async createFolder(params: {
    name: string;
    parentFolderId?: number;
    workspaceId?: number;
  }): Promise<Folder> {
    const base = params.parentFolderId
      ? `/folders/${params.parentFolderId}/folders`
      : params.workspaceId
        ? `/workspaces/${params.workspaceId}/folders`
        : '/home/folders';

    return this.client.post<Folder>(base, { name: params.name });
  }

  // ============================================
  // Workspaces
  // ============================================

  async listWorkspaces(params?: {
    page?: number;
    pageSize?: number;
    includeAll?: boolean;
  }): Promise<ListWorkspacesResult> {
    return this.client.get<ListWorkspacesResult>('/workspaces', {
      page: params?.page,
      pageSize: params?.pageSize,
      includeAll: params?.includeAll,
    });
  }

  async createWorkspace(name: string): Promise<Workspace> {
    return this.client.post<Workspace>('/workspaces', { name });
  }

  async deleteWorkspace(id: number): Promise<void> {
    await this.client.delete(`/workspaces/${id}`);
  }

  // ============================================
  // Reports
  // ============================================

  async listReports(params?: {
    page?: number;
    pageSize?: number;
    modifiedSince?: string;
    includeAll?: boolean;
  }): Promise<ListReportsResult> {
    return this.client.get<ListReportsResult>('/reports', {
      page: params?.page,
      pageSize: params?.pageSize,
      modifiedSince: params?.modifiedSince,
      includeAll: params?.includeAll,
    });
  }

  async getReport(id: number): Promise<ReportSummary> {
    return this.client.get<ReportSummary>(`/reports/${id}`);
  }

  // ============================================
  // Attachments
  // ============================================

  async listAttachments(
    sheetId: number,
    params?: { page?: number; pageSize?: number },
  ): Promise<ListAttachmentsResult> {
    return this.client.get<ListAttachmentsResult>(`/sheets/${sheetId}/attachments`, {
      page: params?.page,
      pageSize: params?.pageSize,
    });
  }

  // ============================================
  // Discussions
  // ============================================

  async listDiscussions(
    sheetId: number,
    params?: { include?: string[]; page?: number; pageSize?: number },
  ): Promise<ListDiscussionsResult> {
    return this.client.get<ListDiscussionsResult>(`/sheets/${sheetId}/discussions`, {
      include: params?.include?.join(','),
      page: params?.page,
      pageSize: params?.pageSize,
    });
  }

  async addDiscussion(sheetId: number, text: string): Promise<Discussion> {
    return this.client.post<Discussion>(`/sheets/${sheetId}/discussions`, {
      comment: { text },
    });
  }

  // ============================================
  // Automation
  // ============================================

  async listAutomationRules(sheetId: number): Promise<ListAutomationRulesResult> {
    return this.client.get<ListAutomationRulesResult>(`/sheets/${sheetId}/automationrules`);
  }

  // ============================================
  // Users
  // ============================================

  async listUsers(params?: {
    email?: string;
    page?: number;
    pageSize?: number;
    includeAll?: boolean;
  }): Promise<ListUsersResult> {
    return this.client.get<ListUsersResult>('/users', {
      email: params?.email,
      page: params?.page,
      pageSize: params?.pageSize,
      includeAll: params?.includeAll,
    });
  }

  async inviteUser(params: InviteUserParams): Promise<User> {
    return this.client.request<User>('/users', {
      method: 'POST',
      params: params.sendEmail !== undefined ? { sendEmail: params.sendEmail } : undefined,
      body: {
        email: params.email,
        admin: params.admin,
        licensedSheetCreator: params.licensedSheetCreator,
        firstName: params.firstName,
        lastName: params.lastName,
      },
    });
  }

  // ============================================
  // Contacts
  // ============================================

  async listContacts(params?: { page?: number; pageSize?: number }): Promise<ListContactsResult> {
    return this.client.get<ListContactsResult>('/contacts', {
      page: params?.page,
      pageSize: params?.pageSize,
    });
  }

  // ============================================
  // Webhooks
  // ============================================

  async listWebhooks(params?: { page?: number; pageSize?: number }): Promise<ListWebhooksResult> {
    return this.client.get<ListWebhooksResult>('/webhooks', {
      page: params?.page,
      pageSize: params?.pageSize,
    });
  }

  async createWebhook(params: CreateWebhookParams): Promise<Webhook> {
    return this.client.post<Webhook>('/webhooks', {
      name: params.name,
      callbackUrl: params.callbackUrl,
      scope: params.scope,
      scopeObjectId: params.scopeObjectId,
      events: params.events,
      version: params.version ?? 1,
    });
  }
}

export { SmartsheetClient } from './client';
