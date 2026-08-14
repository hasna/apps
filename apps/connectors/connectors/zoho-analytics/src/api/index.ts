// Zoho Analytics Connector — BI and analytics platform
import { ZohoAnalyticsClient } from './client';
import type { ZohoAnalyticsConfig } from '../types';

export { ZohoAnalyticsClient, DC_BASES } from './client';

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Zoho Analytics: ${label} is required`);
  }
  return value.trim();
}

export class ZohoAnalytics {
  private readonly client: ZohoAnalyticsClient;

  constructor(config: ZohoAnalyticsConfig) {
    this.client = new ZohoAnalyticsClient(config);
  }

  static fromEnv(): ZohoAnalytics {
    const token = process.env.ZOHO_ANALYTICS_TOKEN;
    const orgId = process.env.ZOHO_ANALYTICS_ORG_ID;
    if (!token) throw new Error('ZOHO_ANALYTICS_TOKEN is required');
    if (!orgId) throw new Error('ZOHO_ANALYTICS_ORG_ID is required');
    return new ZohoAnalytics({
      token,
      orgId,
      dataCenter: process.env.ZOHO_ANALYTICS_DATA_CENTER,
      baseUrl: process.env.ZOHO_ANALYTICS_BASE_URL,
    });
  }

  async listWorkspaces() {
    return this.client.request('GET', '/workspaces');
  }

  async getWorkspaceDetails(workspaceId: string) {
    return this.client.request('GET', `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}`);
  }

  async createWorkspace(options: { workspaceName: string; workspaceDescription?: string }) {
    return this.client.request('POST', '/workspaces', {
      configParam: {
        workspaceName: requireString(options.workspaceName, 'workspaceName'),
        workspaceDesc: options.workspaceDescription,
      },
    });
  }

  async deleteWorkspace(workspaceId: string) {
    return this.client.request('DELETE', `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}`);
  }

  async listViews(workspaceId: string, options?: { viewTypes?: number[] }) {
    return this.client.request(
      'GET',
      `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}/views`,
      { configParam: { viewTypes: options?.viewTypes } },
    );
  }

  async getViewDetails(workspaceId: string, viewId: string) {
    return this.client.request(
      'GET',
      `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}/views/${encodeURIComponent(requireString(viewId, 'viewId'))}`,
    );
  }

  async deleteView(workspaceId: string, viewId: string) {
    return this.client.request(
      'DELETE',
      `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}/views/${encodeURIComponent(requireString(viewId, 'viewId'))}`,
    );
  }

  async copyView(options: {
    workspaceId: string;
    viewIds: string[];
    destWorkspaceId: string;
    destNamePrefix?: string;
  }) {
    return this.client.request(
      'POST',
      `/workspaces/${encodeURIComponent(requireString(options.workspaceId, 'workspaceId'))}/views/copy`,
      {
        configParam: {
          viewIds: options.viewIds,
          destWorkspaceId: requireString(options.destWorkspaceId, 'destWorkspaceId'),
          destNamePrefix: options.destNamePrefix,
        },
      },
    );
  }

  async createTable(
    workspaceId: string,
    tableDesign: {
      tableName: string;
      columns: Array<Record<string, unknown>>;
      folderName?: string;
      description?: string;
    },
  ) {
    return this.client.request(
      'POST',
      `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}/tables`,
      { configParam: { tableDesign } },
    );
  }

  async addRow(workspaceId: string, viewId: string, columnValues: Record<string, unknown>) {
    return this.client.request(
      'POST',
      `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}/views/${encodeURIComponent(requireString(viewId, 'viewId'))}/rows`,
      { configParam: { columns: columnValues } },
    );
  }

  async updateRow(
    workspaceId: string,
    viewId: string,
    criteria: string,
    columnValues: Record<string, unknown>,
  ) {
    return this.client.request(
      'PUT',
      `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}/views/${encodeURIComponent(requireString(viewId, 'viewId'))}/rows`,
      {
        configParam: {
          criteria: requireString(criteria, 'criteria'),
          columns: columnValues,
        },
      },
    );
  }

  async deleteRow(workspaceId: string, viewId: string, criteria: string) {
    return this.client.request(
      'DELETE',
      `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}/views/${encodeURIComponent(requireString(viewId, 'viewId'))}/rows`,
      { configParam: { criteria: requireString(criteria, 'criteria') } },
    );
  }

  async importData(
    workspaceId: string,
    viewId: string,
    options: {
      importType: 'APPEND' | 'TRUNCATEADD' | 'UPDATEADD';
      data: string;
      fileType?: 'CSV' | 'JSON' | 'TSV';
      autoIdentify?: boolean;
      matchingColumns?: string[];
    },
  ) {
    return this.client.request(
      'POST',
      `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}/views/${encodeURIComponent(requireString(viewId, 'viewId'))}/data`,
      {
        configParam: {
          importType: options.importType,
          data: options.data,
          fileType: options.fileType ?? 'CSV',
          autoIdentify: options.autoIdentify,
          matchingColumns: options.matchingColumns,
        },
      },
    );
  }

  async exportData(
    workspaceId: string,
    viewId: string,
    options?: { responseFormat?: 'csv' | 'xls' | 'xlsx' | 'json' | 'pdf'; criteria?: string },
  ) {
    return this.client.request(
      'GET',
      `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}/views/${encodeURIComponent(requireString(viewId, 'viewId'))}/data`,
      {
        configParam: {
          responseFormat: options?.responseFormat ?? 'csv',
          criteria: options?.criteria,
        },
      },
    );
  }

  async runQuery(
    workspaceId: string,
    sqlQuery: string,
    options?: { responseFormat?: 'csv' | 'json' | 'xls' | 'xlsx' },
  ) {
    return this.client.request(
      'POST',
      `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}/data`,
      {
        configParam: {
          sqlQuery: requireString(sqlQuery, 'sqlQuery'),
          responseFormat: options?.responseFormat ?? 'json',
        },
      },
    );
  }

  async listFolders(workspaceId: string) {
    return this.client.request(
      'GET',
      `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}/folders`,
    );
  }

  async createFolder(
    workspaceId: string,
    options: { folderName: string; folderDescription?: string; parentFolderId?: string },
  ) {
    return this.client.request(
      'POST',
      `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}/folders`,
      {
        configParam: {
          folderName: requireString(options.folderName, 'folderName'),
          folderDesc: options.folderDescription,
          parentFolderId: options.parentFolderId,
        },
      },
    );
  }

  async deleteFolder(workspaceId: string, folderId: string) {
    return this.client.request(
      'DELETE',
      `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}/folders/${encodeURIComponent(requireString(folderId, 'folderId'))}`,
    );
  }

  async listUsers() {
    return this.client.request('GET', '/users');
  }

  async addUsers(emailIds: string[], role: 'ADMIN' | 'USER' | 'VIEWER') {
    return this.client.request('POST', '/users', {
      configParam: { emailIds, role },
    });
  }

  async removeUsers(emailIds: string[]) {
    return this.client.request('DELETE', '/users', {
      configParam: { emailIds },
    });
  }

  async listShareInfo(workspaceId: string, viewIds?: string[]) {
    return this.client.request(
      'GET',
      `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}/share`,
      { configParam: { viewIds } },
    );
  }

  async shareViews(
    workspaceId: string,
    options: { viewIds: string[]; emailIds: string[]; permissions: Record<string, unknown> },
  ) {
    return this.client.request(
      'POST',
      `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}/share`,
      {
        configParam: {
          viewIds: options.viewIds,
          emailIds: options.emailIds,
          permissions: options.permissions,
        },
      },
    );
  }

  async unshareViews(workspaceId: string, viewIds: string[], emailIds: string[]) {
    return this.client.request(
      'DELETE',
      `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}/share`,
      {
        configParam: { viewIds, emailIds },
      },
    );
  }

  async listSlideshows(workspaceId: string) {
    return this.client.request(
      'GET',
      `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}/slideshows`,
    );
  }

  async createSlideshow(
    workspaceId: string,
    options: { slideshowName: string; viewIds: string[]; description?: string },
  ) {
    return this.client.request(
      'POST',
      `/workspaces/${encodeURIComponent(requireString(workspaceId, 'workspaceId'))}/slideshows`,
      {
        configParam: {
          slideshowName: requireString(options.slideshowName, 'slideshowName'),
          viewIds: options.viewIds,
          description: options.description,
        },
      },
    );
  }

  async getOrgDetails() {
    return this.client.request('GET', '/orgs');
  }

  getClient(): ZohoAnalyticsClient {
    return this.client;
  }
}
