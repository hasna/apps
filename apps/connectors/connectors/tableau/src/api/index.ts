import type {
  TableauConfig,
  PageOptions,
  WorkbooksResponse,
  WorkbookResponse,
  ViewsResponse,
  ViewResponse,
  DataSourcesResponse,
  ProjectsResponse,
  UsersResponse,
} from '../types';
import { TableauClient } from './client';

function pageParams(options?: PageOptions): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (options?.pageSize !== undefined) {
    params.pageSize = options.pageSize;
  }
  if (options?.pageNumber !== undefined) {
    params.pageNumber = options.pageNumber;
  }
  return params;
}

export class Tableau {
  private readonly client: TableauClient;

  constructor(config: TableauConfig) {
    this.client = new TableauClient(config);
  }

  static fromEnv(): Tableau {
    const serverUrl = process.env.TABLEAU_SERVER_URL;
    if (!serverUrl) {
      throw new Error('TABLEAU_SERVER_URL environment variable is required');
    }

    const patName = process.env.TABLEAU_PAT_NAME;
    const patSecret = process.env.TABLEAU_PAT_SECRET;
    const username = process.env.TABLEAU_USERNAME;
    const password = process.env.TABLEAU_PASSWORD;

    if (!(patName && patSecret) && !(username && password)) {
      throw new Error(
        'Tableau credentials are required: set TABLEAU_PAT_NAME + TABLEAU_PAT_SECRET or TABLEAU_USERNAME + TABLEAU_PASSWORD',
      );
    }

    return new Tableau({
      serverUrl,
      siteName: process.env.TABLEAU_SITE_NAME,
      apiVersion: process.env.TABLEAU_API_VERSION,
      username,
      password,
      patName,
      patSecret,
    });
  }

  getClient(): TableauClient {
    return this.client;
  }

  getServerUrlPreview(): string {
    return this.client.getServerUrlPreview();
  }

  // ============================================
  // Workbooks
  // ============================================

  async listWorkbooks(options?: PageOptions): Promise<WorkbooksResponse> {
    return this.client.get<WorkbooksResponse>('/workbooks', pageParams(options));
  }

  async getWorkbook(workbookId: string): Promise<WorkbookResponse> {
    return this.client.get<WorkbookResponse>(`/workbooks/${encodeURIComponent(workbookId)}`);
  }

  /** Query the views contained in a specific workbook. */
  async queryViews(workbookId: string, options?: PageOptions): Promise<ViewsResponse> {
    return this.client.get<ViewsResponse>(
      `/workbooks/${encodeURIComponent(workbookId)}/views`,
      pageParams(options),
    );
  }

  // ============================================
  // Views
  // ============================================

  async listViews(options?: PageOptions): Promise<ViewsResponse> {
    return this.client.get<ViewsResponse>('/views', pageParams(options));
  }

  async getView(viewId: string): Promise<ViewResponse> {
    return this.client.get<ViewResponse>(`/views/${encodeURIComponent(viewId)}`);
  }

  // ============================================
  // Data Sources
  // ============================================

  async listDataSources(options?: PageOptions): Promise<DataSourcesResponse> {
    return this.client.get<DataSourcesResponse>('/datasources', pageParams(options));
  }

  // ============================================
  // Projects
  // ============================================

  async listProjects(options?: PageOptions): Promise<ProjectsResponse> {
    return this.client.get<ProjectsResponse>('/projects', pageParams(options));
  }

  // ============================================
  // Users
  // ============================================

  async listUsers(options?: PageOptions): Promise<UsersResponse> {
    return this.client.get<UsersResponse>('/users', pageParams(options));
  }
}

export { TableauClient } from './client';
